import type { AppDeps } from '../app.js';

const RELEVANCE: Record<string, string[]> = {
  INVENTORY_DISCREPANCY: ['RECONCILIATION', 'ISSUE', 'RETURN'],
  STORAGE_ENVIRONMENT: ['STORAGE_MOVE', 'INSPECTION', 'RECEIPT'],
  PACKAGING_LABELLING_DEFECT: ['RECEIPT', 'INSPECTION'],
  DOCUMENTATION_CUSTODY_GAP: ['ISSUE', 'RETURN', 'STORAGE_MOVE'],
  UNAUTHORISED_ACCESS: ['ISSUE', 'STORAGE_MOVE'],
  TRANSPORT_HANDLING_DAMAGE: ['RECEIPT', 'ISSUE'],
  INSPECTION_OVERDUE: ['INSPECTION'],
};

export interface LifecycleEventRow {
  id: string; assetId: string; eventType: string; fromLocation: string | null; toLocation: string | null; quantity: number;
  actorPseudo: string; occurredAt: Date; payload: unknown; ledgerTxId: string | null;
}

const COLS = `e.id, e.asset_id as "assetId", e.event_type as "eventType", e.from_location as "fromLocation", e.to_location as "toLocation",
  e.quantity, e.actor_pseudo as "actorPseudo", e.occurred_at as "occurredAt", e.payload, e.ledger_tx_id as "ledgerTxId"`;

/** Top 5 events on the case's assets (or, without assets, on assets stored at its location) within ±30 days, most relevant first. */
export async function suggestLifecycleEvents(deps: AppDeps, caseId: string): Promise<LifecycleEventRow[]> {
  const { rows } = await deps.pool.query(
    `with c as (select category, location_ref, coalesce(occurred_at, created_at) as at,
                       array(select jsonb_array_elements_text(ledger_json->'assetRefs')) as assets,
                       array(select jsonb_array_elements_text(ledger_json->'linkedEventIds')) as linked
                from cases where case_id = $1)
     select ${COLS}, coalesce(array_position($2::text[], e.event_type), 99) as rank
     from lifecycle_events e, c
     where (case when cardinality(c.assets) > 0 then e.asset_id = any(c.assets)
                 else e.asset_id in (select id from assets where current_location = c.location_ref)
                      or e.to_location = c.location_ref or e.from_location = c.location_ref end)
       and e.occurred_at between c.at - interval '30 days' and c.at + interval '30 days'
       and not (e.id = any(c.linked))
     order by rank, abs(extract(epoch from (e.occurred_at - c.at))) limit 5`,
    [caseId, await relevanceFor(deps, caseId)]);
  return rows.map(({ rank: _r, ...e }) => e as LifecycleEventRow);
}

async function relevanceFor(deps: AppDeps, caseId: string): Promise<string[]> {
  const { rows } = await deps.pool.query('select category from cases where case_id = $1', [caseId]);
  return RELEVANCE[rows[0]?.category] ?? ['INCIDENT'];
}

export async function linkedLifecycleEvents(deps: AppDeps, ids: string[]): Promise<LifecycleEventRow[]> {
  if (!ids.length) return [];
  const { rows } = await deps.pool.query(`select ${COLS} from lifecycle_events e where e.id = any($1) order by e.occurred_at`, [ids]);
  return rows;
}
