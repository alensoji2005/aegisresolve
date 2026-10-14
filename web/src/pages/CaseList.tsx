import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch, errorText, type RiskLevel } from '../api';
import { EscalationBadge, ErrorNote, fmt, RiskBadge, StatusBadge } from '../components/ui';

interface Row {
  caseId: string; status: string; category: string | null; riskLevel: RiskLevel | null; slaDueAt: string; escalationLevel: number;
  depot: string; outcome: string | null; triageStatus: string; createdAt: string;
}

const RISK_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function CaseList({ title, query = '', sortByRisk = false }: { title: string; query?: string; sortByRisk?: boolean }) {
  const q = useQuery({ queryKey: ['cases', query], queryFn: () => apiFetch<Row[]>(`/cases?${query}`), refetchInterval: 15_000 });
  const rows = [...(q.data ?? [])];
  if (sortByRisk) rows.sort((a, b) => (RISK_ORDER[a.riskLevel ?? ''] ?? 9) - (RISK_ORDER[b.riskLevel ?? ''] ?? 9) || a.slaDueAt.localeCompare(b.slaDueAt));
  return (
    <div className="card overflow-x-auto">
      <h1 className="mb-3 text-base font-semibold">{title}</h1>
      <ErrorNote error={q.error ? errorText(q.error) : null} />
      {q.isLoading ? <p className="text-sm text-ink/60">Loading…</p> : rows.length === 0 ? <p className="text-sm text-ink/60">No cases.</p> : (
        <table className="w-full min-w-[640px]">
          <thead><tr><th className="th">Case</th><th className="th">Status</th><th className="th">Category</th><th className="th">Risk</th><th className="th">SLA due</th><th className="th">Filed</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.caseId} className="hover:bg-paper">
                <td className="td font-mono"><Link className="text-accent underline-offset-2 hover:underline" to={`/cases/${r.caseId}`}>{r.caseId}</Link></td>
                <td className="td"><StatusBadge status={r.status} /> <EscalationBadge level={r.escalationLevel} /></td>
                <td className="td">{r.category?.replaceAll('_', ' ').toLowerCase() ?? (r.triageStatus === 'FAILED' ? 'triage failed — retrying' : 'awaiting triage')}</td>
                <td className="td"><RiskBadge level={r.riskLevel} /></td>
                <td className="td">{fmt(r.slaDueAt)}</td>
                <td className="td">{fmt(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
