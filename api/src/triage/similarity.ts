import type { AppDeps } from '../app.js';

export interface Suggestion { caseId: string; linkType: 'DUPLICATE' | 'RELATED'; score: number; reasons: string[] }

export const THRESHOLDS = { duplicate: 0.9, related: 0.75, duplicateMaxDays: 30, lookbackDays: 180, recurringCount: 3, recurringDays: 90 };

export const toVector = (v: number[]) => '[' + v.join(',') + ']';

/** Nearest earlier/other cases by embedding, boosted by shared asset, location and category. */
export async function findSimilar(deps: AppDeps, caseId: string): Promise<Suggestion[]> {
  const self = (await deps.pool.query(
    `select c.created_at, c.location_ref, c.category, c.ledger_json->'assetRefs' as assets, a.embedding::text as embedding
     from cases c join case_ai a using (case_id) where c.case_id = $1`, [caseId])).rows[0];
  if (!self?.embedding) return [];
  const { rows } = await deps.pool.query(
    `select c.case_id, c.created_at, c.location_ref, c.category, c.ledger_json->'assetRefs' as assets, 1 - (a.embedding <=> $1::vector) as cos
     from case_ai a join cases c using (case_id)
     where c.case_id <> $2 and c.status <> 'PENDING_LEDGER' and c.created_at > $3::timestamptz - make_interval(days => $4)
     order by a.embedding <=> $1::vector limit 20`,
    [self.embedding, caseId, self.created_at, THRESHOLDS.lookbackDays]);
  const myAssets: string[] = self.assets ?? [];
  const out: Suggestion[] = [];
  for (const r of rows) {
    const shared = (r.assets as string[] ?? []).filter((a) => myAssets.includes(a));
    const sameLoc = r.location_ref === self.location_ref;
    const sameCat = !!self.category && r.category === self.category;
    const cos = Number(r.cos);
    const score = Math.min(1, cos + (shared.length ? 0.05 : 0) + (sameLoc ? 0.05 : 0) + (sameCat ? 0.03 : 0));
    const days = Math.round(Math.abs(new Date(r.created_at).getTime() - new Date(self.created_at).getTime()) / 864e5);
    const reasons = [`cosine ${cos.toFixed(2)}`, ...shared.map((a) => `same lot ${a}`), ...(sameLoc ? [`same location ${r.location_ref}`] : []),
      ...(sameCat ? ['same category'] : []), `filed ${days} days apart`];
    if (score >= THRESHOLDS.duplicate && shared.length && days <= THRESHOLDS.duplicateMaxDays) {
      out.push({ caseId: r.case_id, linkType: 'DUPLICATE', score: round(score), reasons });
    } else if (score >= THRESHOLDS.related) {
      out.push({ caseId: r.case_id, linkType: 'RELATED', score: round(score), reasons });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Recurring: at least 3 linked cases sharing this case's location or an asset within 90 days. */
export async function isRecurring(deps: AppDeps, caseId: string): Promise<boolean> {
  const { rows } = await deps.pool.query(
    `select count(distinct o.case_id)::int as n
     from case_links k join cases c on c.case_id = k.case_id join cases o on o.case_id = k.linked_case_id
     where k.case_id = $1 and abs(extract(epoch from (o.created_at - c.created_at))) <= $2 * 86400
       and (o.location_ref = c.location_ref or (o.ledger_json->'assetRefs') ?| array(select jsonb_array_elements_text(c.ledger_json->'assetRefs')))`,
    [caseId, THRESHOLDS.recurringDays]);
  return rows[0].n >= THRESHOLDS.recurringCount;
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;
