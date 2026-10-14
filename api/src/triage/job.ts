import type { CaseRecord, Category } from '../../../chaincode/aegis-cc/src/types.js';
import { CATEGORIES } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { projectCase } from '../cases/projection.js';
import { decryptContent } from '../cases/service.js';
import { canonicalJson, sha256Hex } from '../crypto.js';
import { systemUser } from '../users/service.js';
import { computeRisk, riskContext } from './risk.js';
import { findSimilar, isRecurring, toVector } from './similarity.js';

/**
 * AI triage: classify, embed, find similar cases, score risk, anchor the hash of the full AI result on-chain and
 * move the case to TRIAGED. Never throws; failures are recorded and retried by the ticker (max 3 attempts).
 */
export async function runTriage(deps: AppDeps, caseId: string): Promise<void> {
  const claimed = await deps.pool.query(
    `update cases set triage_attempts = triage_attempts + 1 where case_id = $1 and status = 'SUBMITTED' and triage_status <> 'DONE' returning case_id`,
    [caseId]);
  if (!claimed.rowCount) return;
  try {
    const { title, description } = await decryptContent(deps, caseId);
    const ai = await deps.ai.analyze(`${title}\n${description}`);
    const category = (CATEGORIES.includes(ai.category as Category) ? ai.category : 'CONDUCT_PROCESS_GRIEVANCE') as Category;
    await deps.pool.query(
      `insert into case_ai(case_id, category_probs, entities, model_versions, result_sha256, embedding) values ($1,$2,$3,$4,'pending',$5::vector)
       on conflict (case_id) do update set category_probs = excluded.category_probs, entities = excluded.entities,
         model_versions = excluded.model_versions, embedding = excluded.embedding`,
      [caseId, JSON.stringify(ai.categoryProbs), JSON.stringify(ai.entities), JSON.stringify({ classifier: ai.modelVersion }), toVector(ai.embedding)]);
    await deps.pool.query('update cases set category = $2 where case_id = $1', [caseId, category]);

    const similar = await findSimilar(deps, caseId);
    for (const s of similar) {
      await deps.pool.query(
        `insert into case_links(case_id, linked_case_id, link_type, similarity, reasons) values ($1,$2,$3,$4,$5) on conflict do nothing`,
        [caseId, s.caseId, s.linkType, s.score, JSON.stringify(s.reasons)]);
    }
    const recurring = await isRecurring(deps, caseId);
    const risk = computeRisk({ category, severityHits: ai.severityHits, ...(await riskContext(deps, caseId)) });
    const explanation = { factors: risk.factors, score: risk.score, level: risk.level, topKeywords: ai.topKeywords,
      needsHumanTriage: ai.needsHumanTriage, recurring, similar };
    const resultHash = sha256Hex(canonicalJson({ category, categoryProbs: ai.categoryProbs, entities: ai.entities, modelVersion: ai.modelVersion,
      embedding: ai.embedding, explanation }));
    await deps.pool.query('update case_ai set risk_explanation = $2, result_sha256 = $3 where case_id = $1', [caseId, JSON.stringify(explanation), resultHash]);

    const { result } = await deps.ledger.submit<CaseRecord>(await systemUser(deps), 'complaint:triage',
      [caseId, category, risk.score.toFixed(4), resultHash, JSON.stringify(similar.map((s) => s.caseId))]);
    await projectCase(deps, result);
    await deps.pool.query(`update cases set triage_status = 'DONE' where case_id = $1`, [caseId]);
  } catch (e) {
    console.error('triage failed', caseId, e instanceof Error ? e.message : e);
    await deps.pool.query(`update cases set triage_status = 'FAILED' where case_id = $1`, [caseId]);
  }
}
