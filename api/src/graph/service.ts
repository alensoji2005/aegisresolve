import type { AppDeps } from '../app.js';
import { ApiError } from '../errors.js';

export type NodeType = 'case' | 'lot' | 'loc' | 'event' | 'person' | 'anomaly';
export interface GraphNode { id: string; type: NodeType; label: string; data: Record<string, unknown> }
export interface GraphEdge { source: string; target: string; label: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }

const MAX_NODES = 200;
const NODE_RE = /^(case|lot|loc|event|person|anomaly):[\w/-]{1,64}$/;

type Expand = { nodes: GraphNode[]; edges: GraphEdge[] };
const n = (type: NodeType, key: string, label: string, data: Record<string, unknown> = {}): GraphNode => ({ id: `${type}:${key}`, type, label, data });

/** One hop from a node. Content never leaves the API here: only ids, categories, statuses and pseudonyms. */
async function neighbours(deps: AppDeps, id: string): Promise<Expand> {
  const [type, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  const q = async (sql: string, p: unknown[]) => (await deps.pool.query(sql, p)).rows;
  const out: Expand = { nodes: [], edges: [] };
  const add = (node: GraphNode, label: string, reverse = false) => {
    out.nodes.push(node);
    out.edges.push(reverse ? { source: node.id, target: id, label } : { source: id, target: node.id, label });
  };
  const caseNode = (r: any) => n('case', r.case_id, r.case_id, { status: r.status, category: r.category, riskLevel: r.risk_level });
  const eventNode = (r: any) => n('event', r.id, `${r.event_type} ${String(r.occurred_at.toISOString?.() ?? r.occurred_at).slice(0, 10)}`,
    { eventType: r.event_type, occurredAt: r.occurred_at, asset: r.asset_id, actor: r.actor_pseudo });

  if (type === 'case') {
    const [c] = await q(`select case_id, location_ref, ledger_json from cases where case_id = $1 and status <> 'PENDING_LEDGER'`, [key]);
    if (!c) return out;
    for (const lot of c.ledger_json.assetRefs ?? []) add(n('lot', lot, lot), 'concerns');
    add(n('loc', c.location_ref, c.location_ref), 'at');
    const ev = c.ledger_json.linkedEventIds ?? [];
    if (ev.length) for (const r of await q('select * from lifecycle_events where id = any($1)', [ev])) add(eventNode(r), 'linked event');
    for (const r of await q(
      `select c.case_id, c.status, c.category, c.risk_level, k.link_type, k.confirmed_by is not null as confirmed
       from case_links k join cases c on c.case_id = case when k.case_id = $1 then k.linked_case_id else k.case_id end
       where k.case_id = $1 or k.linked_case_id = $1`, [key])) {
      add(caseNode(r), `${r.link_type.toLowerCase()}${r.confirmed ? '' : ' (suggested)'}`);
    }
    for (const r of await q('select id, family, subject, day, score from anomalies where case_id = $1', [key])) {
      add(n('anomaly', r.id, `${r.family} anomaly`, { subject: r.subject, day: r.day, score: r.score }), 'flagged by', true);
    }
  } else if (type === 'lot') {
    const [a] = await q('select current_location, item_type from assets where id = $1', [key]);
    if (a?.current_location) add(n('loc', a.current_location, a.current_location), 'stored in');
    for (const r of await q(`select case_id, status, category, risk_level from cases where ledger_json->'assetRefs' ? $1 and status <> 'PENDING_LEDGER'`, [key])) {
      add(caseNode(r), 'concerns', true);
    }
    for (const r of await q('select * from lifecycle_events where asset_id = $1 order by occurred_at desc limit 12', [key])) add(eventNode(r), 'on', true);
  } else if (type === 'loc') {
    for (const r of await q(`select case_id, status, category, risk_level from cases where location_ref = $1 and status <> 'PENDING_LEDGER'`, [key])) {
      add(caseNode(r), 'at', true);
    }
    for (const r of await q('select id, item_type from assets where current_location = $1 order by id', [key])) add(n('lot', r.id, r.id, { itemType: r.item_type }), 'stored in', true);
    for (const r of await q(`select id, family, subject, day, score from anomalies where subject = $1 order by day desc limit 5`, [key])) {
      add(n('anomaly', r.id, `${r.family} anomaly`, { subject: r.subject, day: r.day, score: r.score }), 'flagged by', true);
    }
  } else if (type === 'event') {
    const [e] = await q('select * from lifecycle_events where id = $1', [key]);
    if (!e) return out;
    add(n('lot', e.asset_id, e.asset_id), 'on');
    add(n('person', e.actor_pseudo, e.actor_pseudo, { unit: e.actor_unit }), 'performed by');
  } else if (type === 'person') {
    for (const r of await q('select * from lifecycle_events where actor_pseudo = $1 order by occurred_at desc limit 12', [key])) add(eventNode(r), 'performed by', true);
    for (const r of await q(`select id, family, subject, day, score from anomalies where subject = $1 order by day desc limit 5`, [key])) {
      add(n('anomaly', r.id, `${r.family} anomaly`, { subject: r.subject, day: r.day, score: r.score }), 'flagged by', true);
    }
  }
  return out;
}

/** Breadth-first expansion around a node, capped at 200 nodes. */
export async function graphAround(deps: AppDeps, center: string, depth: number): Promise<Graph> {
  if (!NODE_RE.test(center)) throw new ApiError(400, 'INVALID_ARG', 'center must look like case:CASE-2026-000001, lot:…, loc:…, event:…, person:…');
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const type = center.slice(0, center.indexOf(':')) as NodeType;
  nodes.set(center, n(type, center.slice(center.indexOf(':') + 1), center.slice(center.indexOf(':') + 1)));
  let frontier = [center];
  let truncated = false;
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const x = await neighbours(deps, id);
      for (const node of x.nodes) {
        const existing = nodes.get(node.id);
        if (existing) { Object.assign(existing.data, node.data); continue; }
        if (nodes.size >= MAX_NODES) { truncated = true; continue; }
        nodes.set(node.id, node);
        next.push(node.id);
      }
      for (const e of x.edges) {
        if (nodes.has(e.source) && nodes.has(e.target)) edges.set([e.source, e.target].sort().join('|') + e.label, e);
      }
    }
    frontier = next;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], truncated };
}

/** Cross-cutting patterns worth an investigator's attention. */
export async function graphInsights(deps: AppDeps) {
  const q = async (sql: string) => (await deps.pool.query(sql)).rows;
  return {
    lotsWithRepeatedComplaints: await q(
      `select a as lot, count(*)::int as cases from cases, jsonb_array_elements_text(ledger_json->'assetRefs') a
       where status <> 'PENDING_LEDGER' group by a having count(*) >= 2 order by cases desc limit 10`),
    locationsWithExcursionsAndOpenCases: await q(
      `select c.location_ref as location, count(distinct c.case_id)::int as "openCases",
              (select count(*)::int from sensor_readings s join locations l on l.id = s.location_id
               where s.location_id = c.location_ref and s.ts > now() - interval '7 days'
                 and (s.rh_pct > l.rh_max or s.temp_c > l.temp_max or s.temp_c < l.temp_min)) as "excursionHours7d"
       from cases c where c.status not in ('CLOSED','CLOSED_FINAL','MERGED_DUPLICATE','PENDING_LEDGER')
       group by c.location_ref having (select count(*) from sensor_readings s join locations l on l.id = s.location_id
         where s.location_id = c.location_ref and s.ts > now() - interval '7 days'
           and (s.rh_pct > l.rh_max or s.temp_c > l.temp_max or s.temp_c < l.temp_min)) > 0 order by 2 desc limit 10`),
    personnelAcrossCases: await q(
      `select e.actor_pseudo as person, count(distinct c.case_id)::int as cases
       from cases c, jsonb_array_elements_text(c.ledger_json->'linkedEventIds') ev join lifecycle_events e on e.id = ev
       group by e.actor_pseudo having count(distinct c.case_id) >= 2 order by cases desc limit 10`),
  };
}
