import { useState } from 'react';
import { apiFetch, errorText, post } from '../api';
import { ErrorNote, fmt, Section, short, StatusBadge } from '../components/ui';

interface Mismatch { caseId: string; field: string; ledger: unknown; projection: unknown }
interface Failure { evidenceId: string; caseId: string; cipherHashOk: boolean; plainSha256Ok: boolean; plainSha3Ok: boolean; ledgerMatch: boolean }

export function AuditConsole() {
  const [rec, setRec] = useState<{ checked: number; mismatches: Mismatch[] } | null>(null);
  const [ev, setEv] = useState<{ checked: number; failures: Failure[] } | null>(null);
  const [caseId, setCaseId] = useState('');
  const [lookup, setLookup] = useState<{ history: any[]; access: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
            ? <p className="text-sm font-medium text-accent">✓ {rec.checked} cases checked · 0 mismatches</p>
            : (
              <table className="w-full">
                <thead><tr><th className="th">Case</th><th className="th">Field</th><th className="th">Ledger</th><th className="th">Database</th></tr></thead>
                <tbody>{rec.mismatches.map((m, i) => (
                  <tr key={i} className="bg-red-50"><td className="td font-mono text-xs">{m.caseId}</td><td className="td">{m.field}</td>
                    <td className="td mono">{short(String(m.ledger), 24)}</td><td className="td mono">{short(String(m.projection), 24)}</td></tr>))}</tbody>
              </table>
            ))}
        </Section>
        <Section title="Evidence integrity"
          actions={<button className="btn-primary" disabled={!!busy} onClick={run('ev', async () => setEv(await post('/audit/verify-evidence')))}>{busy === 'ev' ? 'Verifying…' : 'Verify all'}</button>}>
          <p className="mb-2 text-sm text-ink/60">Re-hashes stored ciphertext and decrypted files against their on-chain anchors.</p>
          {ev && (ev.failures.length === 0
            ? <p className="text-sm font-medium text-accent">✓ {ev.checked} files verified · 0 failures</p>
            : (
              <table className="w-full">
                <thead><tr><th className="th">Evidence</th><th className="th">Case</th><th className="th">Failed checks</th></tr></thead>
                <tbody>{ev.failures.map((f) => (
                  <tr key={f.evidenceId} className="bg-red-50"><td className="td mono">{short(f.evidenceId, 13)}</td><td className="td font-mono text-xs">{f.caseId}</td>
                    <td className="td text-sm">{(['cipherHashOk', 'plainSha256Ok', 'plainSha3Ok', 'ledgerMatch'] as const).filter((k) => !f[k]).join(', ')}</td></tr>))}</tbody>
              </table>
            ))}
        </Section>
      </div>
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
