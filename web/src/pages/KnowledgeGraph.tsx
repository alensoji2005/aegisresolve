import { useQuery } from '@tanstack/react-query';
import cytoscape, { type Core } from 'cytoscape';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch, errorText } from '../api';
import { ErrorNote, Section } from '../components/ui';

interface GNode { id: string; type: string; label: string; data: Record<string, any> }
interface Graph { nodes: GNode[]; edges: { source: string; target: string; label: string }[]; truncated: boolean }
interface Insights {
  lotsWithRepeatedComplaints: { lot: string; cases: number }[];
  locationsWithExcursionsAndOpenCases: { location: string; openCases: number; excursionHours7d: number }[];
  personnelAcrossCases: { person: string; cases: number }[];
}

/** Colour plus shape per type, so the legend does not rely on colour alone. */
export const NODE_STYLE: Record<string, { color: string; shape: string; name: string }> = {
  case: { color: '#0f5c63', shape: 'round-rectangle', name: 'Case' },
  lot: { color: '#b7791f', shape: 'diamond', name: 'Lot' },
  loc: { color: '#4a5568', shape: 'hexagon', name: 'Location' },
  event: { color: '#a0aec0', shape: 'ellipse', name: 'Lifecycle event' },
  person: { color: '#6b46c1', shape: 'triangle', name: 'Personnel (pseudonym)' },
  anomaly: { color: '#c53030', shape: 'star', name: 'Anomaly' },
};

export function KnowledgeGraph() {
  const [params, setParams] = useSearchParams();
  const center = params.get('center') ?? '';
  const [draft, setDraft] = useState(center);
  const [depth, setDepth] = useState(2);
  const [selected, setSelected] = useState<GNode | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);

  const graph = useQuery({ queryKey: ['graph', center, depth], enabled: !!center, queryFn: () => apiFetch<Graph>(`/graph?center=${encodeURIComponent(center)}&depth=${depth}`) });
  const insights = useQuery({ queryKey: ['insights'], queryFn: () => apiFetch<Insights>('/graph/insights') });
  const go = (id: string) => { setDraft(id); setSelected(null); setParams({ center: id }); };

  useEffect(() => {
    if (!box.current || !graph.data) return;
    cy.current?.destroy();
    const c = cytoscape({
      container: box.current,
      elements: [
        ...graph.data.nodes.map((n) => ({ data: { id: n.id, label: n.label, type: n.type } })),
        ...graph.data.edges.map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, label: e.label } })),
      ],
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 9, 'text-valign': 'bottom', 'text-margin-y': 3, width: 22, height: 22, color: '#1c2430' } },
        ...Object.entries(NODE_STYLE).map(([t, s]) => ({ selector: `node[type = "${t}"]`, style: { 'background-color': s.color, shape: s.shape as any } })),
        { selector: `node[id = "${center}"]`, style: { 'border-width': 3, 'border-color': '#1c2430', width: 30, height: 30 } },
        { selector: 'edge', style: { width: 1, 'line-color': '#cbd5e0', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 7, color: '#718096' } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 70 },
    });
    c.on('tap', 'node', (ev) => setSelected(graph.data!.nodes.find((n) => n.id === ev.target.id()) ?? null));
    cy.current = c;
    return () => { c.destroy(); cy.current = null; };
  }, [graph.data, center]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <form className="card flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); go(draft.trim()); }}>
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="center">Start from</label>
            <input id="center" className="input font-mono" placeholder="case:CASE-2026-000001 · lot:LOT-B03-2025-0117 · loc:DEP-02/MAG-01/BAY-04"
              value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <div><label className="label" htmlFor="depth">Hops</label>
            <select id="depth" className="input" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>{[1, 2, 3].map((d) => <option key={d}>{d}</option>)}</select></div>
          <button className="btn-primary" disabled={!draft}>Explore</button>
        </form>
        <ErrorNote error={graph.error ? errorText(graph.error) : null} />
        <div className="card p-0">
          {!center && <p className="p-4 text-sm text-ink/60">Pick a starting point, or choose one of the insights on the right.</p>}
          <div ref={box} className={center ? 'h-[560px] w-full' : 'hidden'} role="img" aria-label="Knowledge graph of cases, lots, locations, events and personnel" />
          {graph.data?.truncated && <p className="border-t border-line px-4 py-2 text-xs text-ink/60">Showing the first 200 nodes; reduce hops to see less.</p>}
        </div>
        <ul className="flex flex-wrap gap-3 text-xs text-ink/70">
          {Object.values(NODE_STYLE).map((s) => (
            <li key={s.name} className="flex items-center gap-1"><span className="inline-block h-3 w-3" style={{ background: s.color, clipPath: s.shape === 'diamond' ? 'polygon(50% 0,100% 50%,50% 100%,0 50%)' : undefined, borderRadius: s.shape === 'ellipse' ? '50%' : 2 }} />{s.name} ({s.shape})</li>
          ))}
        </ul>
      </div>
      <div className="space-y-4">
        {selected && (
          <Section title={selected.label}>
            <p className="mb-2 text-xs uppercase tracking-wide text-ink/60">{NODE_STYLE[selected.type]?.name}</p>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
              {Object.entries(selected.data).map(([k, v]) => <Fragment key={k}><dt className="text-ink/60">{k}</dt><dd className="break-all font-mono text-xs">{String(v ?? '—')}</dd></Fragment>)}
            </dl>
            <div className="mt-3 flex gap-2">
              <button className="btn" onClick={() => go(selected.id)}>Explore from here</button>
              {selected.type === 'case' && <Link className="btn" to={`/cases/${selected.id.slice(5)}`}>Open case</Link>}
            </div>
          </Section>
        )}
        <Section title="Insights">
          <h3 className="label">Lots with repeated complaints</h3>
          <ul className="mb-3 text-sm">{insights.data?.lotsWithRepeatedComplaints.map((x) => (
            <li key={x.lot}><button className="font-mono text-accent underline" onClick={() => go(`lot:${x.lot}`)}>{x.lot}</button> · {x.cases} cases</li>))}
            {insights.data?.lotsWithRepeatedComplaints.length === 0 && <li className="text-ink/50">None</li>}</ul>
          <h3 className="label">Excursions with open cases (7 days)</h3>
          <ul className="mb-3 text-sm">{insights.data?.locationsWithExcursionsAndOpenCases.map((x) => (
            <li key={x.location}><button className="font-mono text-accent underline" onClick={() => go(`loc:${x.location}`)}>{x.location}</button> · {x.excursionHours7d} h out of bounds, {x.openCases} open</li>))}
            {insights.data?.locationsWithExcursionsAndOpenCases.length === 0 && <li className="text-ink/50">None</li>}</ul>
          <h3 className="label">Personnel linked to several cases</h3>
          <ul className="text-sm">{insights.data?.personnelAcrossCases.map((x) => (
            <li key={x.person}><button className="font-mono text-accent underline" onClick={() => go(`person:${x.person}`)}>{x.person}</button> · {x.cases} cases</li>))}
            {insights.data?.personnelAcrossCases.length === 0 && <li className="text-ink/50">None</li>}</ul>
        </Section>
      </div>
    </div>
  );
}
