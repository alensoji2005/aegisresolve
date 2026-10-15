import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, errorText, type RiskLevel } from '../api';
import { ErrorNote, fmt, RiskBadge, Section, StatusBadge } from '../components/ui';

interface Bay { id: string; temp: number | null; rh: number | null; readingAt: string | null; inBoundsNow: boolean; excursionHours7d: number; openCases: number; lots: number; anomalies7d: number }
interface Depot { id: string; magazines: { id: string; bays: Bay[] }[] }
interface Detail {
  location: { id: string; tempMin: number; tempMax: number; rhMax: number };
  readings: { ts: string; temp: number; rh: number; outOfBounds: boolean }[];
  lots: { id: string; itemType: string; quantity: number }[];
  events: { id: string; assetId: string; eventType: string; actorPseudo: string; occurredAt: string }[];
  cases: { caseId: string; status: string; category: string | null; riskLevel: RiskLevel | null }[];
  anomalies: { id: string; family: string; day: string; score: number }[];
}

/** Worst condition wins. Each state has a text label and border style, not just a colour. */
export function bayState(b: Bay): { label: string; cls: string } {
  if (!b.inBoundsNow) return { label: 'Out of bounds now', cls: 'border-red-600 bg-red-50' };
  if (b.excursionHours7d > 0 && b.openCases > 0) return { label: 'Excursion + open case', cls: 'border-orange-500 border-dashed bg-orange-50' };
  if (b.excursionHours7d > 0) return { label: 'Recent excursion', cls: 'border-amber-500 border-dashed bg-amber-50' };
  if (b.openCases > 0 || b.anomalies7d > 0) return { label: 'Open case / anomaly', cls: 'border-accent bg-accent-soft' };
  return { label: 'Normal', cls: 'border-line bg-white' };
}

function Sparkline({ points, max, label }: { points: { v: number; bad: boolean }[]; max: number; label: string }) {
  if (!points.length) return null;
  const w = 320, h = 60, lo = Math.min(...points.map((p) => p.v), max) - 2, hi = Math.max(...points.map((p) => p.v), max) + 2;
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" role="img" aria-label={label}>
      <line x1={0} x2={w} y1={y(max)} y2={y(max)} stroke="#c53030" strokeDasharray="4 3" strokeWidth={1} />
      <polyline fill="none" stroke="#0f5c63" strokeWidth={1.5} points={points.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} />
      {points.map((p, i) => (p.bad ? <circle key={i} cx={x(i)} cy={y(p.v)} r={1.6} fill="#c53030" /> : null))}
    </svg>
  );
}

export function DigitalTwin() {
  const twin = useQuery({ queryKey: ['twin'], queryFn: () => apiFetch<Depot[]>('/twin'), refetchInterval: 30_000 });
  const [sel, setSel] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['twin', sel], enabled: !!sel, queryFn: () => apiFetch<Detail>(`/twin/location?id=${encodeURIComponent(sel!)}`) });
  const d = detail.data;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-4">
        <ErrorNote error={twin.error ? errorText(twin.error) : null} />
        {twin.data?.map((depot) => (
          <Section key={depot.id} title={`Depot ${depot.id}`}>
            <div className="space-y-3">
              {depot.magazines.map((m) => (
                <div key={m.id}>
                  <h3 className="label">{m.id.split('/')[1]}</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {m.bays.map((b) => {
                      const s = bayState(b);
                      return (
                        <button key={b.id} onClick={() => setSel(b.id)} aria-pressed={sel === b.id}
                          className={`rounded border-2 p-2 text-left text-xs ${s.cls} ${sel === b.id ? 'ring-2 ring-ink' : ''}`}>
                          <div className="flex justify-between font-mono font-semibold"><span>{b.id.split('/')[2]}</span><span>{b.lots} lots</span></div>
                          <div className="mt-1">{b.temp ?? '—'}°C · {b.rh ?? '—'}% RH</div>
                          <div className="mt-1 font-medium">{s.label}</div>
                          {b.excursionHours7d > 0 && <div>{b.excursionHours7d} h out of bounds (7 d)</div>}
                          {b.openCases > 0 && <div>{b.openCases} open case{b.openCases > 1 ? 's' : ''}</div>}
                          {b.anomalies7d > 0 && <div>{b.anomalies7d} anomal{b.anomalies7d > 1 ? 'ies' : 'y'}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ))}
        <p className="text-xs text-ink/50">Synthetic sensors, refreshed every 30 s. A dashed border means an excursion in the last 7 days.</p>
      </div>
      <div className="space-y-4">
        {!sel && <Section title="Bay detail"><p className="text-sm text-ink/60">Select a bay.</p></Section>}
        {d && (
          <>
            <Section title={d.location.id} actions={<Link className="btn" to={`/graph?center=loc:${encodeURIComponent(d.location.id)}`}>Graph</Link>}>
              <p className="text-xs text-ink/60">Relative humidity, 7 days (limit {d.location.rhMax}%)</p>
              <Sparkline label="Humidity over 7 days" max={d.location.rhMax} points={d.readings.map((r) => ({ v: r.rh, bad: r.outOfBounds }))} />
              <p className="mt-2 text-xs text-ink/60">Temperature, 7 days (limit {d.location.tempMax}°C)</p>
              <Sparkline label="Temperature over 7 days" max={d.location.tempMax} points={d.readings.map((r) => ({ v: r.temp, bad: r.outOfBounds }))} />
            </Section>
            <Section title="Open cases">
              {d.cases.length ? <ul className="space-y-1 text-sm">{d.cases.map((c) => (
                <li key={c.caseId}><Link className="font-mono text-accent underline" to={`/cases/${c.caseId}`}>{c.caseId}</Link> <StatusBadge status={c.status} /> <RiskBadge level={c.riskLevel} /></li>))}</ul>
                : <p className="text-sm text-ink/60">None</p>}
            </Section>
            {d.anomalies.length > 0 && (
              <Section title="Anomalies"><ul className="text-sm">{d.anomalies.map((a) => <li key={a.id}>{a.family} · {a.day.slice(0, 10)} · score {a.score.toFixed(2)}</li>)}</ul></Section>
            )}
            <Section title="Lots stored here">
              <ul className="max-h-40 overflow-auto text-sm">{d.lots.map((l) => <li key={l.id} className="font-mono text-xs">{l.id} · {l.itemType} · {l.quantity}</li>)}</ul>
            </Section>
            <Section title="Recent events">
              <ul className="text-xs">{d.events.map((e) => <li key={e.id}>{fmt(e.occurredAt)} · {e.eventType} · <span className="font-mono">{e.assetId}</span> · {e.actorPseudo}</li>)}</ul>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
