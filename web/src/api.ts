export type Role = 'COMPLAINANT' | 'STORE_OFFICER' | 'INVESTIGATOR' | 'SAFETY_OFFICER' | 'REVIEW_BOARD' | 'AUDITOR' | 'ADMIN' | 'SYSTEM';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AuthUser { id: string; username: string; role: Role; unit: string; depot: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

let accessToken: string | null = null;
let onUser: ((u: AuthUser | null) => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const onUserChange = (fn: (u: AuthUser | null) => void) => { onUser = fn; };

export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return false;
      const b = await r.json();
      accessToken = b.accessToken;
      onUser?.(b.user);
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const r = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });
  if (r.status === 401 && retry && !path.startsWith('/auth/') && (await refreshSession())) return apiFetch<T>(path, init, false);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new ApiError(r.status, b.error?.code ?? `HTTP_${r.status}`, b.error?.message ?? r.statusText, b.error?.details);
  }
  return (r.headers.get('content-type') ?? '').includes('json') ? r.json() : (r.blob() as Promise<T>);
}

export const post = <T>(path: string, body: unknown = {}) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

export async function uploadEvidence(caseId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return apiFetch<{ id: string; sha256Plain: string; txId: string }>(`/cases/${caseId}/evidence`, { method: 'POST', body: fd });
}

export async function downloadEvidence(caseId: string, evidenceId: string, filename: string) {
  const blob = await apiFetch<Blob>(`/cases/${caseId}/evidence/${evidenceId}/download`);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const COI_MESSAGES: Record<string, string> = {
  R1: 'investigator is the complainant on this case',
  R2: 'investigator belongs to the same unit as personnel in the linked events',
  R3: 'investigator handled the asset within the last 90 days',
  R4: 'investigator is based at the case depot',
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'COI_VIOLATION') {
    const rules: string[] = e.details?.violations ?? [];
    return rules.map((r) => `Blocked by conflict-of-interest rule ${r}: ${COI_MESSAGES[r] ?? 'rule failed'}`).join('\n');
  }
  if (e instanceof ApiError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Mirror of the chaincode closure quorum (chaincode/aegis-cc/src/rules.ts POLICY.closureQuorum). */
export const CLOSURE_QUORUM: Record<RiskLevel, Role[]> = {
  LOW: ['SAFETY_OFFICER'],
  MEDIUM: ['SAFETY_OFFICER', 'REVIEW_BOARD'],
  HIGH: ['SAFETY_OFFICER', 'REVIEW_BOARD', 'REVIEW_BOARD'],
  CRITICAL: ['SAFETY_OFFICER', 'REVIEW_BOARD', 'REVIEW_BOARD'],
};
