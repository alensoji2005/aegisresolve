import { riskLevelFromScore } from '../../../chaincode/aegis-cc/src/rules.js';
import type { Category, RiskLevel } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';

export const CATEGORY_BASE: Record<Category, number> = {
  UNAUTHORISED_ACCESS: 1.0,
  SAFETY_PROCEDURE_VIOLATION: 0.9,
  STORAGE_ENVIRONMENT: 0.8,
  INVENTORY_DISCREPANCY: 0.8,
  DOCUMENTATION_CUSTODY_GAP: 0.7,
  TRANSPORT_HANDLING_DAMAGE: 0.6,
  PACKAGING_LABELLING_DEFECT: 0.5,
  INSPECTION_OVERDUE: 0.5,
  FACILITY_EQUIPMENT_FAULT: 0.4,
  CONDUCT_PROCESS_GRIEVANCE: 0.3,
};

export interface RiskInput {
  category: Category;
  severityHits: number;
  sensorExcursionFraction: number;
  recentRelatedCount: number;
  assetOverdue: boolean;
  quantityMismatch: boolean;
}

export interface RiskFactor { name: string; weight: number; value: number; contribution: number }

/** Deterministic, explainable weighted sum; every term is reported so reviewers can see why a case scored as it did. */
export function computeRisk(i: RiskInput): { score: number; level: RiskLevel; factors: RiskFactor[] } {
  const terms: [string, number, number][] = [
    ['category', 0.3, CATEGORY_BASE[i.category] ?? 0.5],
    ['severity', 0.2, Math.min(i.severityHits, 3) / 3],
    ['sensor_excursion', 0.2, Math.min(Math.max(i.sensorExcursionFraction, 0), 1)],
    ['recurrence', 0.15, Math.min(i.recentRelatedCount, 3) / 3],
    ['asset_overdue', 0.1, i.assetOverdue ? 1 : 0],
    ['quantity_mismatch', 0.05, i.quantityMismatch ? 1 : 0],
  ];
  const factors = terms.map(([name, weight, value]) => ({ name, weight, value: round(value), contribution: round(weight * value) }));
  const score = round(Math.min(1, factors.reduce((s, f) => s + f.contribution, 0)));
  return { score, level: riskLevelFromScore(score), factors };
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

export async function riskContext(deps: AppDeps, caseId: string): Promise<Omit<RiskInput, 'category' | 'severityHits'>> {
  const { rows } = await deps.pool.query(
    `with c as (
       select case_id, location_ref, coalesce(occurred_at, created_at) as at,
              coalesce(array(select jsonb_array_elements_text(ledger_json->'assetRefs')), '{}') as assets
       from cases where case_id = $1)
     select
       (select count(*)::float / 168 from sensor_readings s join locations l on l.id = s.location_id, c
          where s.location_id = c.location_ref and s.ts between c.at - interval '7 days' and c.at
            and (s.temp_c > l.temp_max or s.temp_c < l.temp_min or s.rh_pct > l.rh_max)) as sensor,
       (select count(distinct k.linked_case_id)::int from case_links k join cases o on o.case_id = k.linked_case_id, c
          where k.case_id = c.case_id and o.created_at > c.at - interval '90 days') as related,
       (select exists (select 1 from assets a, c where a.id = any(c.assets)
          and a.manufactured_on + make_interval(months => a.shelf_life_months) < c.at)) as overdue,
       (select exists (select 1 from lifecycle_events e, c where e.asset_id = any(c.assets) and e.event_type = 'RECONCILIATION'
          and e.occurred_at between c.at - interval '30 days' and c.at and coalesce((e.payload->>'discrepancy')::int, 0) <> 0)) as mismatch`,
    [caseId]);
  const r = rows[0];
  return { sensorExcursionFraction: Math.min(1, Number(r.sensor) || 0), recentRelatedCount: r.related, assetOverdue: r.overdue, quantityMismatch: r.mismatch };
}
