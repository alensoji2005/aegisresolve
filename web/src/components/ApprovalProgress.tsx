import { CLOSURE_QUORUM, type RiskLevel, type Role } from '../api';
import { fmt } from './ui';

export interface ApprovalView { role: Role; signer: string; at: string }

/** Matches each required slot to a distinct signer of that role, mirroring the chaincode quorum rule. */
export function fillSlots(required: Role[], approvals: ApprovalView[]): (ApprovalView | null)[] {
  const used = new Set<string>();
  return required.map((role) => {
    const a = approvals.find((x) => x.role === role && !used.has(x.signer));
    if (a) used.add(a.signer);
    return a ?? null;
  });
}

export function ApprovalProgress({ level, approvals }: { level: RiskLevel; approvals: ApprovalView[] }) {
  const required = CLOSURE_QUORUM[level];
  const slots = fillSlots(required, approvals);
  const filled = slots.filter(Boolean).length;
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{filled} of {required.length} signatures</p>
      <ol className="space-y-1">
        {required.map((role, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${slots[i] ? 'bg-accent' : 'border border-ink/40'}`} aria-hidden />
            <span className="w-36 text-ink/70">{role.replaceAll('_', ' ').toLowerCase()}</span>
            {slots[i] ? <span>{slots[i]!.signer} · {fmt(slots[i]!.at)}</span> : <span className="text-ink/40">awaiting signature</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
