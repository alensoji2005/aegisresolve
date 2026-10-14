import type { ReactNode } from 'react';
import type { RiskLevel } from '../api';

const RISK_STYLE: Record<RiskLevel, string> = {
  LOW: 'bg-slate-100 text-slate-700 border-slate-300',
  MEDIUM: 'bg-amber-50 text-amber-800 border-amber-300',
  HIGH: 'bg-orange-50 text-orange-800 border-orange-400',
  CRITICAL: 'bg-red-50 text-red-800 border-red-400',
};

export function RiskBadge({ level }: { level: RiskLevel | null }) {
  if (!level) return <span className="text-xs text-ink/50">untriaged</span>;
  return <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${RISK_STYLE[level]}`}>{level}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const done = status === 'CLOSED' || status === 'CLOSED_FINAL' || status === 'MERGED_DUPLICATE';
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${done ? 'border-line bg-paper text-ink/70' : 'border-accent/40 bg-accent-soft text-accent'}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function EscalationBadge({ level }: { level: number }) {
  if (!level) return null;
  return <span className="rounded border border-red-400 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800">Escalated L{level}</span>;
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="whitespace-pre-line rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
}

export const fmt = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const short = (s: string | null | undefined, n = 12) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '—');
