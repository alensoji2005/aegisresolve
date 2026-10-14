export interface Factor { name: string; weight: number; value: number; contribution: number }

const LABELS: Record<string, string> = {
  category: 'Category base risk',
  severity: 'Severity keywords',
  sensor_excursion: 'Sensor excursion (7 days)',
  recurrence: 'Related cases (90 days)',
  asset_overdue: 'Asset past shelf life',
  quantity_mismatch: 'Reconciliation discrepancy',
};

export function sortFactors(factors: Factor[]): Factor[] {
  return [...factors].sort((a, b) => b.contribution - a.contribution);
}

export function RiskBars({ factors }: { factors: Factor[] }) {
  return (
    <ul className="space-y-1.5">
      {sortFactors(factors).map((f) => (
        <li key={f.name} className="grid grid-cols-[12rem_1fr_3.5rem] items-center gap-2 text-sm">
          <span className="text-ink/70">{LABELS[f.name] ?? f.name}</span>
          <span className="h-2 rounded bg-paper" aria-hidden>
            <span className="block h-2 rounded bg-accent" style={{ width: `${Math.round((f.contribution / 0.3) * 100)}%` }} />
          </span>
          <span className="text-right font-mono text-xs">{f.contribution.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}
