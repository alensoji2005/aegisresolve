import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch, errorText, post } from '../api';
import { ErrorNote, fmt, Section, short, StatusBadge } from '../components/ui';

interface Mismatch { caseId: string; field: string; ledger: unknown; projection: unknown }
interface Failure { evidenceId: string; caseId: string; cipherHashOk: boolean; plainSha256Ok: boolean; plainSha3Ok: boolean; ledgerMatch: boolean }

const FIELD_LABEL: Record<string, string> = {
  status: 'Case status', riskLevel: 'Risk level', escalationLevel: 'Escalation level', investigator: 'Assigned investigator',
  content: 'Complaint text', existence: 'Case missing from ledger',
};

const CHECK_LABEL = {
  cipherHashOk: 'Stored file differs from the anchored file',
  plainSha256Ok: 'Content fingerprint (SHA-256) does not match',
  plainSha3Ok: 'Content fingerprint (SHA3-256) does not match',
  ledgerMatch: 'Database hashes differ from the ledger',
};

interface Incident { id: number; kind: string; caseId: string; action: string; detectedBy: string; detectedAt: string }

const INCIDENT_KIND: Record<string, string> = {
  CASE_FIELD: 'Case record edited in the database', CONTENT: 'Complaint text rewritten', EVIDENCE: 'Evidence file altered', MISSING_ON_LEDGER: 'Case missing from blockchain',
};
const INCIDENT_ACTION: Record<string, string> = {
  REPAIRED_FROM_LEDGER: '✓ Restored from blockchain', CONTENT_WITHHELD: '🔒 Text withheld', QUARANTINED: '🔒 File quarantined', FLAGGED: '⚠ Flagged',
};

function TamperAlert({ text }: { text: string }) {
  return (
    <div role="alert" className="mb-3 flex items-start gap-2 rounded border-2 border-red-600 bg-red-600 px-3 py-2 text-sm font-semibold text-white">
      <span aria-hidden className="text-lg leading-none">⚠</span>
      <span>TAMPERING DETECTED — {text}</span>
    </div>
  );
}

function AllClear({ text }: { text: string }) {
  return (
    <div role="status" className="flex items-center gap-2 rounded border-2 border-accent bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">
      <span aria-hidden>✓</span><span>No tampering · {text}</span>
    </div>
  );
}

export function AuditConsole() {
  const [rec, setRec] = useState<{ checked: number; mismatches: Mismatch[] } | null>(null);
  const [ev, setEv] = useState<{ checked: number; failures: Failure[] } | null>(null);
  const [caseId, setCaseId] = useState('');
  const [lookup, setLookup] = useState<{ history: any[]; access: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [repair, setRepair] = useState<{ repaired: Mismatch[]; unrepairable: Mismatch[] } | null>(null);
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => apiFetch<Incident[]>('/audit/incidents'), refetchInterval: 60_000 });

  const run = (name: string, fn: () => Promise<void>) => async () => {
    setBusy(name);
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Database ↔ ledger reconciliation"
          actions={<button className="btn-primary" disabled={!!busy} onClick={run('rec', async () => setRec(await apiFetch('/audit/reconcile')))}>{busy === 'rec' ? 'Checking…' : 'Run reconcile'}</button>}>
          <p className="mb-2 text-sm text-ink/60">Compares every case record and the hash of its decrypted text with the blockchain.</p>
          {rec && (rec.mismatches.length === 0
            ? <AllClear text={`${rec.checked} cases checked · database matches the blockchain`} />
            : (
              <>
                <TamperAlert text={`${rec.mismatches.length} record${rec.mismatches.length > 1 ? 's' : ''} in the database differ from the blockchain`} />
                <table className="w-full">
                  <thead><tr><th className="th">Case</th><th className="th">What was changed</th><th className="th">Blockchain (true)</th><th className="th">Database (tampered)</th></tr></thead>
                  <tbody>{rec.mismatches.map((m, i) => (
                    <tr key={i} className="border-l-4 border-red-600 bg-red-50">
                      <td className="td font-mono text-xs">{m.caseId}</td>
                      <td className="td font-semibold text-red-800">✗ {FIELD_LABEL[m.field] ?? m.field}</td>
                      <td className="td mono text-ink">{short(String(m.ledger), 24)}</td>
                      <td className="td mono font-semibold text-red-800">{short(String(m.projection), 24)}</td></tr>))}</tbody>
                </table>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className="btn-primary" disabled={!!busy} onClick={run('repair', async () => {
                    const r = await post<{ repaired: Mismatch[]; unrepairable: Mismatch[] }>('/audit/repair');
                    setRepair(r);
                    setRec(await apiFetch('/audit/reconcile'));
                    await incidents.refetch();
                  })}>{busy === 'repair' ? 'Repairing…' : 'Repair from blockchain'}</button>
                  <span className="text-xs text-ink/60">Restores the database copy from the ledger. This also runs automatically every 5 minutes.</span>
                </div>
              </>
            ))}
          {repair && (
            <div role="status" className="mt-3 rounded border border-line bg-paper p-3 text-sm">
              <p className="font-semibold text-accent">✓ Restored {repair.repaired.length} field{repair.repaired.length === 1 ? '' : 's'} from the blockchain.</p>
              {repair.unrepairable.length > 0 && (
                <p className="mt-1 text-red-800">✗ {repair.unrepairable.length} could not be restored (only a hash is on-chain).
                  The altered text is <strong>withheld from every view</strong> and the incident is logged.</p>
              )}
            </div>
          )}
        </Section>
        <Section title="Evidence integrity"
          actions={<button className="btn-primary" disabled={!!busy} onClick={run('ev', async () => setEv(await post('/audit/verify-evidence')))}>{busy === 'ev' ? 'Verifying…' : 'Verify all'}</button>}>
          <p className="mb-2 text-sm text-ink/60">Re-hashes stored ciphertext and decrypted files against their on-chain anchors.</p>
          {ev && (ev.failures.length === 0
            ? <AllClear text={`${ev.checked} files verified · every file matches its on-chain fingerprint`} />
            : (
              <>
                <TamperAlert text={`${ev.failures.length} evidence file${ev.failures.length > 1 ? 's have' : ' has'} been altered or replaced`} />
                <table className="w-full">
                  <thead><tr><th className="th">Evidence</th><th className="th">Case</th><th className="th">Failed checks</th></tr></thead>
                  <tbody>{ev.failures.map((f) => (
                    <tr key={f.evidenceId} className="border-l-4 border-red-600 bg-red-50">
                      <td className="td mono">{short(f.evidenceId, 13)}</td><td className="td font-mono text-xs">{f.caseId}</td>
                      <td className="td"><ul className="space-y-0.5 text-sm font-semibold text-red-800">
                        {(Object.keys(CHECK_LABEL) as (keyof typeof CHECK_LABEL)[]).filter((k) => !f[k]).map((k) => <li key={k}>✗ {CHECK_LABEL[k]}</li>)}
                      </ul></td></tr>))}</tbody>
                </table>
                <p className="mt-2 text-sm font-semibold text-red-800">🔒 Quarantined: these files can no longer be downloaded by anyone.</p>
              </>
            ))}
        </Section>
      </div>
      <Section title="Integrity incidents" actions={<button className="btn" onClick={() => incidents.refetch()}>Refresh</button>}>
        <p className="mb-2 text-sm text-ink/60">Every detected tampering and the automatic response. The background check runs every 5 minutes.</p>
        {!incidents.data?.length ? <p className="text-sm text-ink/60">No incidents.</p> : (
          <table className="w-full">
            <thead><tr><th className="th">When</th><th className="th">Case</th><th className="th">What</th><th className="th">Response</th><th className="th">Detected by</th></tr></thead>
            <tbody>{incidents.data.map((i) => (
              <tr key={i.id}>
                <td className="td whitespace-nowrap">{fmt(i.detectedAt)}</td><td className="td font-mono text-xs">{i.caseId}</td>
                <td className="td">{INCIDENT_KIND[i.kind] ?? i.kind}</td>
                <td className="td font-semibold">{INCIDENT_ACTION[i.action] ?? i.action}</td><td className="td">{i.detectedBy}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Section>
      <Section title="Case lookup">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run('look', async () => setLookup({
          history: await apiFetch(`/audit/cases/${caseId}/history`), access: await apiFetch(`/audit/access-log?caseId=${caseId}`),
        }))(); }}>
          <input className="input max-w-xs font-mono" placeholder="CASE-2026-000001" value={caseId} onChange={(e) => setCaseId(e.target.value.trim())} />
          <button className="btn" disabled={!!busy || !/^CASE-\d{4}-\d{6}$/.test(caseId)}>Look up</button>
        </form>
        {lookup && (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="label">Ledger history</h3>
              <ul className="space-y-1 text-sm">{lookup.history.map((h, i) => (
                <li key={i}><StatusBadge status={h.status} /> {fmt(h.at)} · {h.actor.split(':')[0].toLowerCase()} <span className="mono text-ink/50">{short(h.txId, 14)}</span></li>))}</ul>
            </div>
            <div>
              <h3 className="label">Access log</h3>
              {lookup.access.length === 0 ? <p className="text-sm text-ink/60">No full views or downloads.</p> : (
                <ul className="space-y-1 text-sm">{lookup.access.map((a, i) => (
                  <li key={i}>{fmt(a.at)} · {a.role.toLowerCase()} · {a.scope.startsWith('EVIDENCE') ? 'downloaded evidence' : 'opened full case'}</li>))}</ul>
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
