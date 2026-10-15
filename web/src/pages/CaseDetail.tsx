import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, downloadEvidence, errorText, post, type RiskLevel, uploadEvidence } from '../api';
import { useAuth } from '../auth';
import { ApprovalProgress, type ApprovalView } from '../components/ApprovalProgress';
import { type Factor, RiskBars } from '../components/RiskBars';
import { EscalationBadge, ErrorNote, fmt, RiskBadge, Section, short, StatusBadge } from '../components/ui';

interface CaseView {
  caseId: string; view: 'SUMMARY' | 'FULL'; status: string; category: string | null; riskLevel: RiskLevel | null; riskScore?: number;
  slaDueAt: string; escalationLevel: number; outcome: string | null; closedAt: string | null; createdAt: string; isOwner: boolean;
  timeline: { status: string; at: string }[];
  title?: string; description?: string; assetRefs?: string[]; locationRef?: string;
  investigator?: { id: string | null; username: string } | null; coi?: { passed: boolean; rulesEvaluated: string[] } | null;
  approvals?: ApprovalView[]; relatedCaseIds?: string[]; linkedEventIds?: string[]; findingsOutcome?: string | null;
  findings?: { body: { body: string; outcome: string; correctiveAction: string | null }; createdAt: string } | null;
  grants?: { full: boolean; identity: boolean } | null;
  integrity?: { contentIntact: boolean };
  ai?: { categoryProbs: Record<string, number>; entities: { type: string; value: string }[];
    explanation: { factors: Factor[]; topKeywords: string[]; needsHumanTriage: boolean; recurring: boolean } | null } | null;
}

const TABS = ['Overview', 'Evidence', 'Lifecycle', 'Related', 'Findings & review', 'Ledger', 'Disclosure'] as const;
const DISCLOSURE_ROLES = ['SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'];

export function CaseDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['case', id], queryFn: () => apiFetch<CaseView>(`/cases/${id}`) });
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <p className="text-sm text-ink/60">Loading…</p>;
  if (q.error || !q.data) return <ErrorNote error={errorText(q.error)} />;
  const c = q.data;
  const ctx: Ctx = { c, act, busy, role: user!.role, userId: user!.id };

  return (
    <div className="space-y-4">
      <header className="card flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-base font-semibold">{c.caseId}</h1>
        <StatusBadge status={c.status} /><RiskBadge level={c.riskLevel} /><EscalationBadge level={c.escalationLevel} />
        <span className="text-sm text-ink/60">SLA due {fmt(c.slaDueAt)}</span>
        {c.outcome && <span className="text-sm">Outcome: <strong>{c.outcome.replaceAll('_', ' ').toLowerCase()}</strong></span>}
      </header>
      <ErrorNote error={error} />
      {c.view === 'SUMMARY' ? <SummaryView ctx={ctx} /> : (
        <>
          <nav className="flex flex-wrap gap-1" role="tablist">
            {TABS.filter((t) => t !== 'Disclosure' || DISCLOSURE_ROLES.includes(user!.role)).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 text-sm ${tab === t ? 'bg-accent text-white' : 'bg-white text-ink/70 hover:bg-white/60'}`}>{t}</button>)}
          </nav>
          {tab === 'Overview' && <Overview ctx={ctx} />}
          {tab === 'Evidence' && <Evidence ctx={ctx} />}
          {tab === 'Lifecycle' && <Lifecycle ctx={ctx} />}
          {tab === 'Related' && <Related ctx={ctx} />}
          {tab === 'Findings & review' && <Review ctx={ctx} />}
          {tab === 'Ledger' && <Ledger caseId={c.caseId} />}
          {tab === 'Disclosure' && <Disclosures ctx={ctx} />}
        </>
      )}
    </div>
  );
}

interface Ctx { c: CaseView; act: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean; role: string; userId: string }

function Timeline({ items }: { items: { status: string; at: string }[] }) {
  return (
    <ol className="space-y-1 border-l border-line pl-4">
      {items.map((t, i) => <li key={i} className="text-sm"><StatusBadge status={t.status} /> <span className="text-ink/60">{fmt(t.at)}</span></li>)}
    </ol>
  );
}

function SummaryView({ ctx: { c, act, busy } }: { ctx: Ctx }) {
  const [reason, setReason] = useState('');
  const canAppeal = c.isOwner && c.status === 'CLOSED' && c.closedAt && Date.now() < Date.parse(c.closedAt) + 14 * 864e5;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Progress"><Timeline items={c.timeline} /></Section>
      <div className="space-y-4">
        {c.isOwner && <EvidenceUpload caseId={c.caseId} act={act} />}
        {canAppeal && (
          <Section title="Appeal the outcome">
            <textarea className="input h-24" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why should the outcome be reviewed?" />
            <button className="btn-primary mt-2" disabled={busy || reason.length < 10} onClick={() => act(() => post(`/cases/${c.caseId}/appeal`, { reason }))}>File appeal</button>
            <p className="mt-1 text-xs text-ink/50">Appeals are open for 14 days after closure.</p>
          </Section>
        )}
      </div>
    </div>
  );
}

function Overview({ ctx: { c, act, busy, role, userId } }: { ctx: Ctx }) {
  const assignedToMe = c.investigator?.id === userId;
  const ex = c.ai?.explanation;
  return (
    <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
      <div className="space-y-4">
        <Section title={c.title ?? 'Complaint'} actions={<Link className="btn" to={`/graph?center=case:${c.caseId}`}>Knowledge graph</Link>}>
          {c.integrity?.contentIntact === false
            ? <div role="alert" className="rounded border-2 border-red-600 bg-red-50 p-3 text-sm font-semibold text-red-800">⚠ The stored complaint text no longer matches its fingerprint on the blockchain. It has been withheld and the incident logged for the auditor.</div>
            : <p className="whitespace-pre-wrap text-sm">{c.description}</p>}
          <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-ink/60">Location</dt><dd className="font-mono">{c.locationRef}</dd>
            <dt className="text-ink/60">Lots</dt><dd className="font-mono">{c.assetRefs?.join(', ') || '—'}</dd>
            <dt className="text-ink/60">Investigator</dt><dd>{c.investigator?.username ?? 'unassigned'}{c.coi && <span className="ml-2 text-xs text-ink/60">COI {c.coi.passed ? 'passed' : 'failed'} ({c.coi.rulesEvaluated.join(', ')})</span>}</dd>
          </dl>
        </Section>
        {ex && (
          <Section title={`AI triage · risk score ${c.riskScore?.toFixed(2) ?? '—'}`} actions={ex.needsHumanTriage ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">needs human triage</span> : null}>
            <RiskBars factors={ex.factors} />
            <div className="mt-3 text-sm"><span className="text-ink/60">Category: </span>
              {Object.entries(c.ai!.categoryProbs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, p]) => <span key={k} className="mr-3">{k.replaceAll('_', ' ').toLowerCase()} <span className="font-mono text-xs">{(p * 100).toFixed(0)}%</span></span>)}
            </div>
            <div className="mt-1 text-sm"><span className="text-ink/60">Keywords: </span>{ex.topKeywords.join(', ') || '—'}</div>
            <div className="mt-1 flex flex-wrap gap-1">{c.ai!.entities.map((e, i) => <span key={i} className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs">{e.type}: {e.value}</span>)}</div>
            {ex.recurring && <p className="mt-2 text-sm font-medium text-orange-800">Recurring issue: 3+ related cases on this asset or location in 90 days.</p>}
          </Section>
        )}
      </div>
      <div className="space-y-4">
        <Section title="Timeline"><Timeline items={c.timeline} /></Section>
        {c.grants?.identity && <IdentityReveal caseId={c.caseId} />}
        {c.status === 'TRIAGED' && (role === 'SAFETY_OFFICER' || role === 'REVIEW_BOARD') && <AssignBox caseId={c.caseId} act={act} busy={busy} />}
        {c.status === 'ASSIGNED' && assignedToMe && (
          <Section title="Assignment"><button className="btn-primary" disabled={busy} onClick={() => act(() => post(`/cases/${c.caseId}/accept`))}>Accept assignment</button>
            <p className="mt-1 text-xs text-ink/50">Your own certificate is re-checked for conflicts of interest.</p></Section>
        )}
      </div>
    </div>
  );
}

function AssignBox({ caseId, act, busy }: { caseId: string; act: Ctx['act']; busy: boolean }) {
  const inv = useQuery({ queryKey: ['investigators'], queryFn: () => apiFetch<{ id: string; username: string; unit: string; depot: string }[]>('/investigators') });
  const [sel, setSel] = useState('');
  return (
    <Section title="Assign investigator">
      <select className="input" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">Choose…</option>
        {inv.data?.map((i) => <option key={i.id} value={i.id}>{i.username} · {i.unit} · {i.depot === 'NONE' ? 'external' : i.depot}</option>)}
      </select>
      <button className="btn-primary mt-2" disabled={busy || !sel} onClick={() => act(() => post(`/cases/${caseId}/assign`, { investigatorUserId: sel }))}>Assign</button>
    </Section>
  );
}

function EvidenceUpload({ caseId, act }: { caseId: string; act: Ctx['act'] }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <Section title="Add evidence">
      <input type="file" accept=".jpg,.jpeg,.png,.pdf,.mp3,.wav,.txt,.csv,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn mt-2" disabled={!file} onClick={() => act(() => uploadEvidence(caseId, file!))}>Upload</button>
    </Section>
  );
}

interface EvidenceRow { id: string; filename: string | null; mimeType: string; sizeBytes: number; sha256Plain: string; txId: string; createdAt: string; quarantinedAt: string | null }
interface VerifyReport { cipherHashOk: boolean; plainSha256Ok: boolean; plainSha3Ok: boolean; ledgerMatch: boolean; ok: boolean }

function Evidence({ ctx: { c, act, role, userId } }: { ctx: Ctx }) {
  const list = useQuery({ queryKey: ['evidence', c.caseId], queryFn: () => apiFetch<EvidenceRow[]>(`/cases/${c.caseId}/evidence`) });
  const [reports, setReports] = useState<Record<string, VerifyReport>>({});
  const canUpload = c.investigator?.id === userId;
  const canDownload = role !== 'AUDITOR';
  return (
    <div className="space-y-4">
      <Section title="Evidence">
        <table className="w-full">
          <thead><tr><th className="th">File</th><th className="th">SHA-256</th><th className="th">Anchored</th><th className="th">Integrity</th><th className="th" /></tr></thead>
          <tbody>
            {list.data?.map((e) => {
              const r = reports[e.id];
              return (
                <tr key={e.id}>
                  <td className="td">{e.filename ?? 'file'}<div className="text-xs text-ink/50">{e.mimeType} · {(e.sizeBytes / 1024).toFixed(0)} KB</div></td>
                  <td className="td mono" title={e.sha256Plain}>{short(e.sha256Plain, 20)}</td>
                  <td className="td mono" title={e.txId}>{short(e.txId, 14)}<div className="font-sans text-ink/50">{fmt(e.createdAt)}</div></td>
                  <td className="td">{r ? (r.ok ? <span className="text-accent">✓ verified</span>
                    : <span className="text-red-800">✗ {Object.entries(r).filter(([k, v]) => k !== 'ok' && v === false).map(([k]) => k).join(', ')}</span>) : '—'}</td>
                  <td className="td space-x-1 whitespace-nowrap">
                    <button className="btn" onClick={() => act(async () => setReports({ ...reports, [e.id]: await apiFetch<VerifyReport>(`/cases/${c.caseId}/evidence/${e.id}/verify`) }))}>Verify</button>
                    {e.quarantinedAt && <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">🔒 Quarantined — tampered</span>}
                    {canDownload && !e.quarantinedAt && <button className="btn" onClick={() => act(() => downloadEvidence(c.caseId, e.id, e.filename ?? 'evidence'))}>Download</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.data?.length === 0 && <p className="text-sm text-ink/60">No evidence uploaded.</p>}
      </Section>
      {canUpload && <EvidenceUpload caseId={c.caseId} act={act} />}
    </div>
  );
}

interface EventRow { id: string; assetId: string; eventType: string; fromLocation: string | null; toLocation: string | null; quantity: number; actorPseudo: string; occurredAt: string; ledgerTxId: string }

function EventTable({ rows, select }: { rows: EventRow[]; select?: { chosen: Set<string>; toggle: (id: string) => void } }) {
  return (
    <table className="w-full">
      <thead><tr>{select && <th className="th" />}<th className="th">Event</th><th className="th">Type</th><th className="th">Lot</th><th className="th">Where</th><th className="th">Qty</th><th className="th">By</th><th className="th">When</th></tr></thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id}>
            {select && <td className="td"><input type="checkbox" aria-label={`link ${e.id}`} checked={select.chosen.has(e.id)} onChange={() => select.toggle(e.id)} /></td>}
            <td className="td font-mono text-xs">{e.id}</td><td className="td">{e.eventType}</td><td className="td font-mono text-xs">{e.assetId}</td>
            <td className="td font-mono text-xs">{e.fromLocation ?? ''}{e.fromLocation && e.toLocation ? ' → ' : ''}{e.toLocation ?? ''}</td>
            <td className="td">{e.quantity}</td><td className="td font-mono text-xs">{e.actorPseudo}</td><td className="td">{fmt(e.occurredAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Lifecycle({ ctx: { c, act, busy, role } }: { ctx: Ctx }) {
  const q = useQuery({ queryKey: ['lifecycle', c.caseId], queryFn: () => apiFetch<{ linked: EventRow[]; suggested: EventRow[] }>(`/cases/${c.caseId}/lifecycle`) });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); setChosen(n); };
  const canLink = role === 'INVESTIGATOR' || role === 'STORE_OFFICER';
  return (
    <div className="space-y-4">
      <Section title="Linked lifecycle events">{q.data?.linked.length ? <EventTable rows={q.data.linked} /> : <p className="text-sm text-ink/60">None linked yet.</p>}</Section>
      <Section title="Suggested events (±30 days, ranked by relevance)"
        actions={canLink && <button className="btn-primary" disabled={busy || !chosen.size}
          onClick={() => act(() => post(`/cases/${c.caseId}/lifecycle-links`, { eventIds: [...chosen] }).then(() => setChosen(new Set())))}>Link {chosen.size || ''} selected</button>}>
        {q.data?.suggested.length ? <EventTable rows={q.data.suggested} select={canLink ? { chosen, toggle } : undefined} /> : <p className="text-sm text-ink/60">No suggestions.</p>}
      </Section>
    </div>
  );
}

interface SimilarRow { caseId: string; linkType: 'DUPLICATE' | 'RELATED'; score: number | null; reasons: string[] | null; confirmed: boolean; status: string }

function Related({ ctx: { c, act, busy, role } }: { ctx: Ctx }) {
  const q = useQuery({ queryKey: ['similar', c.caseId], queryFn: () => apiFetch<SimilarRow[]>(`/cases/${c.caseId}/similar`) });
  const canConfirm = ['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD'].includes(role);
  return (
    <Section title="Similar and related cases">
      {!q.data?.length ? <p className="text-sm text-ink/60">No similar cases found.</p> : (
        <ul className="divide-y divide-line">
          {q.data.map((s) => (
            <li key={s.caseId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link className="font-mono text-accent underline" to={`/cases/${s.caseId}`}>{s.caseId}</Link>
              <span className="rounded bg-paper px-1.5 py-0.5 text-xs">{s.linkType}{s.confirmed ? ' · confirmed' : ' · suggested'}</span>
              <span className="text-ink/60">{s.reasons?.join(' · ')}</span>
              {canConfirm && !s.confirmed && (
                <span className="ml-auto space-x-1">
                  <button className="btn" disabled={busy} onClick={() => act(() => post(`/cases/${c.caseId}/links`, { linkedCaseId: s.caseId }))}>Confirm related</button>
                  {s.linkType === 'DUPLICATE' && <button className="btn-danger" disabled={busy}
                    onClick={() => act(() => post(`/cases/${c.caseId}/duplicate`, { ofCaseId: s.caseId }))}>Merge as duplicate</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Review({ ctx: { c, act, busy, role, userId } }: { ctx: Ctx }) {
  const [f, setF] = useState({ body: '', outcome: 'SUBSTANTIATED', correctiveAction: '' });
  const [reason, setReason] = useState('');
  const reviewer = role === 'SAFETY_OFFICER' || role === 'REVIEW_BOARD';
  const blocks: ReactNode[] = [];
  if (c.findings) {
    blocks.push(
      <Section key="f" title={`Findings · ${c.findings.body.outcome.replaceAll('_', ' ').toLowerCase()}`}>
        <p className="whitespace-pre-wrap text-sm">{c.findings.body.body}</p>
        {c.findings.body.correctiveAction && <p className="mt-2 text-sm"><span className="text-ink/60">Corrective action: </span>{c.findings.body.correctiveAction}</p>}
        <p className="mt-2 text-xs text-ink/50">Submitted {fmt(c.findings.createdAt)}; the hash is signed on the ledger by the investigator.</p>
      </Section>,
    );
  }
  if (c.status === 'UNDER_INVESTIGATION' && c.investigator?.id === userId) {
    blocks.push(
      <Section key="w" title="Submit findings">
        <textarea className="input h-32" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="What did the investigation establish?" />
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <select className="input" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
            <option>SUBSTANTIATED</option><option>PARTIALLY_SUBSTANTIATED</option><option>NOT_SUBSTANTIATED</option>
          </select>
          <input className="input" value={f.correctiveAction} onChange={(e) => setF({ ...f, correctiveAction: e.target.value })} placeholder="Corrective action (optional)" />
        </div>
        <button className="btn-primary mt-2" disabled={busy || f.body.length < 20}
          onClick={() => act(() => post(`/cases/${c.caseId}/findings`, { ...f, correctiveAction: f.correctiveAction || undefined }))}>Sign and submit findings</button>
      </Section>,
    );
  }
  if (c.status === 'FINDINGS_SUBMITTED' && c.riskLevel) {
    blocks.push(
      <Section key="r" title="Closure signatures">
        <ApprovalProgress level={c.riskLevel} approvals={c.approvals ?? []} />
        {reviewer && (
          <div className="mt-3 space-x-2">
            <button className="btn-primary" disabled={busy} onClick={() => act(() => post(`/cases/${c.caseId}/review`, { decision: 'APPROVE' }))}>Approve</button>
            <button className="btn-danger" disabled={busy} onClick={() => act(() => post(`/cases/${c.caseId}/review`, { decision: 'REJECT' }))}>Send back</button>
          </div>
        )}
      </Section>,
    );
  }
  if (c.status === 'APPEALED' && role === 'REVIEW_BOARD') {
    blocks.push(
      <Section key="a" title="Decide appeal">
        <textarea className="input h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the decision" />
        <div className="mt-2 space-x-2">
          <button className="btn-primary" disabled={busy || reason.length < 10} onClick={() => act(() => post(`/cases/${c.caseId}/appeal/decide`, { accept: true, reason }))}>Reopen review</button>
          <button className="btn-danger" disabled={busy || reason.length < 10} onClick={() => act(() => post(`/cases/${c.caseId}/appeal/decide`, { accept: false, reason }))}>Reject appeal</button>
        </div>
        <p className="mt-1 text-xs text-ink/50">Board members who approved the original closure cannot decide its appeal.</p>
      </Section>,
    );
  }
  return blocks.length ? <div className="space-y-4">{blocks}</div> : <Section title="Findings & review"><p className="text-sm text-ink/60">Nothing to do at this stage.</p></Section>;
}

function Ledger({ caseId }: { caseId: string }) {
  const q = useQuery({ queryKey: ['history', caseId], queryFn: () => apiFetch<{ txId: string; at: string; status: string; actor: string; escalationLevel: number }[]>(`/cases/${caseId}/history`) });
  return (
    <Section title="Ledger history (Hyperledger Fabric)">
      <table className="w-full">
        <thead><tr><th className="th">#</th><th className="th">Transaction</th><th className="th">When</th><th className="th">Status</th><th className="th">Signed by</th></tr></thead>
        <tbody>
          {q.data?.map((h, i) => (
            <tr key={h.txId + i}>
              <td className="td">{i + 1}</td><td className="td mono" title={h.txId}>{short(h.txId, 24)}</td><td className="td">{fmt(h.at)}</td>
              <td className="td"><StatusBadge status={h.status} /> <EscalationBadge level={h.escalationLevel} /></td>
              <td className="td text-xs">{h.actor.split(':')[0].replaceAll('_', ' ').toLowerCase()}<div className="mono text-ink/50" title={h.actor}>{short(h.actor.slice(h.actor.indexOf(':') + 1), 40)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function IdentityReveal({ caseId }: { caseId: string }) {
  const [who, setWho] = useState<{ username: string; unit: string; depot: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Complainant identity">
      {who ? <p className="text-sm"><strong>{who.username}</strong> · unit {who.unit} · {who.depot}</p> : (
        <>
          <p className="mb-2 text-sm text-ink/60">You hold an approved disclosure grant. Revealing is recorded on the ledger.</p>
          <button className="btn-danger" onClick={() => apiFetch<typeof who>(`/cases/${caseId}/identity`).then(setWho, (e) => setError(errorText(e)))}>Reveal identity</button>
        </>
      )}
      <ErrorNote error={error} />
    </Section>
  );
}

interface Grant { grantId: string; scope: 'FULL' | 'IDENTITY'; grantee: string; grantedBy: string; approvedBy: string | null; expiresAt: string;
  revoked: boolean; active: boolean; awaitingApproval: boolean; reason: string | null; reasonVerified: boolean }

function Disclosures({ ctx: { c, act, busy, role } }: { ctx: Ctx }) {
  const list = useQuery({ queryKey: ['disclosures', c.caseId], queryFn: () => apiFetch<Grant[]>(`/cases/${c.caseId}/disclosures`) });
  const board = role === 'REVIEW_BOARD';
  const staff = useQuery({ queryKey: ['staff'], enabled: board, queryFn: () => apiFetch<{ id: string; username: string; role: string }[]>('/staff') });
  const [f, setF] = useState({ granteeUserId: '', scope: 'FULL', reason: '', hours: 24 });
  const status = (g: Grant) => (g.revoked ? 'revoked' : g.active ? 'active' : g.awaitingApproval ? 'awaiting 2nd approval' : 'expired');
  return (
    <div className="space-y-4">
      <Section title="Disclosure grants">
        <p className="mb-2 text-sm text-ink/60">Time-limited extra access, recorded on the ledger. Full case access needs one review-board member;
          revealing the complainant's identity needs a second, different one.</p>
        {!list.data?.length ? <p className="text-sm text-ink/60">No grants.</p> : (
          <table className="w-full">
            <thead><tr><th className="th">Scope</th><th className="th">To</th><th className="th">Granted / approved by</th><th className="th">Until</th><th className="th">Status</th><th className="th">Reason</th><th className="th" /></tr></thead>
            <tbody>{list.data.map((g) => (
              <tr key={g.grantId}>
                <td className="td">{g.scope === 'FULL' ? 'Full case' : 'Identity'}</td><td className="td">{g.grantee}</td>
                <td className="td">{g.grantedBy}{g.approvedBy && g.approvedBy !== g.grantedBy ? ` / ${g.approvedBy}` : ''}</td>
                <td className="td">{fmt(g.expiresAt)}</td><td className="td">{status(g)}</td>
                <td className="td text-xs">{g.reason}{g.reason && !g.reasonVerified && <span className="text-red-800"> (does not match ledger hash)</span>}</td>
                <td className="td whitespace-nowrap space-x-1">
                  {board && g.awaitingApproval && <button className="btn" disabled={busy} onClick={() => act(() => post(`/cases/${c.caseId}/disclosures/${g.grantId}/approve`))}>Approve</button>}
                  {board && !g.revoked && <button className="btn-danger" disabled={busy} onClick={() => act(() => post(`/cases/${c.caseId}/disclosures/${g.grantId}/revoke`))}>Revoke</button>}
                </td>
              </tr>))}</tbody>
          </table>
        )}
      </Section>
      {board && (
        <Section title="Grant access">
          <div className="grid gap-2 md:grid-cols-3">
            <select className="input" aria-label="Grantee" value={f.granteeUserId} onChange={(e) => setF({ ...f, granteeUserId: e.target.value })}>
              <option value="">Grant to…</option>
              {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.username} · {s.role.replaceAll('_', ' ').toLowerCase()}</option>)}
            </select>
            <select className="input" aria-label="Scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="FULL">Full case access</option><option value="IDENTITY">Complainant identity</option>
            </select>
            <select className="input" aria-label="Duration" value={f.hours} onChange={(e) => setF({ ...f, hours: Number(e.target.value) })}>
              {[2, 24, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hours` : `${h / 24} day${h > 24 ? 's' : ''}`}</option>)}
            </select>
          </div>
          <textarea className="input mt-2 h-20" placeholder="Reason (recorded; its hash goes on the ledger)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <button className="btn-primary mt-2" disabled={busy || !f.granteeUserId || f.reason.trim().length < 10}
            onClick={() => act(() => post(`/cases/${c.caseId}/disclosures`, f).then(() => setF({ ...f, reason: '' })))}>Grant</button>
        </Section>
      )}
    </div>
  );
}
