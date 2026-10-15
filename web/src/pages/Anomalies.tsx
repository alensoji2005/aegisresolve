import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, errorText, post } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Section } from '../components/ui';

interface Reason { feature: string; value: number; baseline: number; z: number; basis: string }
interface Anomaly { id: string; family: 'lifecycle' | 'access' | 'sensor'; subject: string; day: string; score: number; explanation: Reason[]; caseId: string | null }

const FAMILY_LABEL = { lifecycle: 'Custody / lifecycle', access: 'Case & evidence access', sensor: 'Storage sensors' };

/** "evidence downloads: 14 vs usual 0.3 (z 30.7)" */
export function describeReason(r: Reason): string {
  return `${r.feature.replaceAll('_', ' ')}: ${r.value} vs usual ${r.baseline} (z ${r.z > 0 ? '+' : ''}${r.z}, ${r.basis})`;
}

function subjectLink(a: Anomaly) {
  if (a.family === 'lifecycle') return <Link className="font-mono text-accent underline" to={`/graph?center=person:${a.subject}`}>{a.subject}</Link>;
  if (a.family === 'sensor') return <Link className="font-mono text-accent underline" to={`/graph?center=loc:${encodeURIComponent(a.subject)}`}>{a.subject}</Link>;
  return <span className="font-mono">{a.subject}</span>;
}

export function Anomalies() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [family, setFamily] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['anomalies', family], queryFn: () => apiFetch<Anomaly[]>(`/anomalies${family ? `?family=${family}` : ''}`) });
  const canScan = user && ['SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR'].includes(user.role);

  async function scan() {
    setError(null);
    setMsg('Scanning…');
    try {
      const r = await post<Record<string, number>>('/anomalies/scan');
      setMsg(`Scan complete: ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(', ')} flagged`);
      await qc.invalidateQueries({ queryKey: ['anomalies'] });
    } catch (e) {
      setMsg(null);
      setError(errorText(e));
    }
  }

  return (
    <Section title="Anomalies (last 30 days)" actions={
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="fam">Family</label>
        <select id="fam" className="input w-auto" value={family} onChange={(e) => setFamily(e.target.value)}>
          <option value="">All families</option>
          {Object.entries(FAMILY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {canScan && <button className="btn-primary" onClick={scan}>Run scan now</button>}
      </div>}>
      <p className="mb-3 text-sm text-ink/60">Isolation Forest over daily behaviour per person, staff account and storage bay. Every flag lists the features that
        deviate most from that subject's usual pattern; flags that cannot be explained are not raised. Scans also run hourly.</p>
      {msg && <p className="mb-2 text-sm">{msg}</p>}
      <ErrorNote error={error ?? (q.error ? errorText(q.error) : null)} />
      {q.data?.length === 0 && <p className="text-sm text-ink/60">No anomalies.</p>}
      {!!q.data?.length && (
        <table className="w-full">
          <thead><tr><th className="th">Score</th><th className="th">Type</th><th className="th">Subject</th><th className="th">Day</th><th className="th">Why</th><th className="th">Case</th></tr></thead>
          <tbody>
            {q.data.map((a) => (
              <tr key={a.id}>
                <td className="td font-mono">{a.score.toFixed(2)}</td>
                <td className="td">{FAMILY_LABEL[a.family]}</td>
                <td className="td">{subjectLink(a)}</td>
                <td className="td whitespace-nowrap">{a.day}</td>
                <td className="td"><ul className="space-y-0.5 text-xs">{a.explanation.map((r) => <li key={r.feature}>{describeReason(r)}</li>)}</ul></td>
                <td className="td">{a.caseId ? <Link className="font-mono text-xs text-accent underline" to={`/cases/${a.caseId}`}>{a.caseId}</Link> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
