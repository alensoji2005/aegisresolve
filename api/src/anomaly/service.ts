import type { AppDeps } from '../app.js';
import type { AnomalyFamily, AnomalyRow } from '../triage/aiClient.js';

export const FAMILIES: AnomalyFamily[] = ['lifecycle', 'access', 'sensor'];
const WINDOW_DAYS = 30;

const OFF_HOURS = (col: string) => `(extract(hour from ${col} at time zone 'UTC') < 7 or extract(hour from ${col} at time zone 'UTC') >= 19)`;
const DAY = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`;

/** Daily feature rows per subject over the last 30 days. Subjects: personnel pseudonym, staff username, location id. */
const FEATURE_SQL: Record<AnomalyFamily, string> = {
  lifecycle: `
    select actor_pseudo as subject, ${DAY('occurred_at')} as day,
      count(*)::float as events,
      abs(coalesce(sum(quantity) filter (where event_type = 'ISSUE'), 0) - coalesce(sum(quantity) filter (where event_type = 'RETURN'), 0))::float as issue_return_imbalance,
      avg(case when ${OFF_HOURS('occurred_at')} then 1 else 0 end)::float as off_hours_ratio,
      count(distinct asset_id)::float as distinct_lots
    from lifecycle_events where occurred_at > $1::timestamptz - make_interval(days => ${WINDOW_DAYS}) and occurred_at <= $1
    group by 1, 2`,
  access: `
    select u.username as subject, ${DAY('a.at')} as day,
      (count(*) filter (where a.action = 'FULL'))::float as full_views,
      (count(*) filter (where a.action = 'EVIDENCE'))::float as evidence_downloads,
      count(distinct a.resource)::float as distinct_cases,
      avg(case when ${OFF_HOURS('a.at')} then 1 else 0 end)::float as off_hours_ratio
    from access_events a join users u on u.id = a.user_id
    where u.role <> 'SYSTEM' and a.at > $1::timestamptz - make_interval(days => ${WINDOW_DAYS}) and a.at <= $1
    group by 1, 2`,
  sensor: `
    select s.location_id as subject, ${DAY('s.ts')} as day,
      sum(case when s.rh_pct > l.rh_max or s.temp_c > l.temp_max or s.temp_c < l.temp_min then 1 else 0 end)::float as out_of_bounds_hours,
      max(s.rh_pct)::float as max_rh,
      max(greatest(s.temp_c - l.temp_max, l.temp_min - s.temp_c, 0))::float as max_temp_excess
    from sensor_readings s join locations l on l.id = s.location_id
    where s.ts > $1::timestamptz - make_interval(days => ${WINDOW_DAYS}) and s.ts <= $1
    group by 1, 2`,
};

export async function featureRows(deps: AppDeps, family: AnomalyFamily): Promise<AnomalyRow[]> {
  const { rows } = await deps.pool.query(FEATURE_SQL[family] + ' order by 1, 2', [deps.now()]);
  return rows.map(({ subject, day, ...features }) => ({ subject, day, features }));
}

/** Scores every family with the AI service and upserts the explained anomalies. Sensor anomalies link to the open case at that bay. */
export async function runAnomalyScan(deps: AppDeps): Promise<Record<AnomalyFamily, number>> {
  const counts = { lifecycle: 0, access: 0, sensor: 0 };
  for (const family of FAMILIES) {
    const rows = await featureRows(deps, family);
    if (!rows.length) continue;
    const results = await deps.ai.scoreAnomalies(family, rows);
    const featuresOf = new Map(rows.map((r) => [`${r.subject}|${r.day}`, r.features]));
    for (const r of results.filter((x) => x.anomalous)) {
      await deps.pool.query(
        `insert into anomalies(family, subject, day, score, features, explanation, case_id, detected_at)
         values ($1, $2, $3, $4, $5, $6,
           case when $1 = 'sensor' then (select case_id from cases where location_ref = $2
             and status not in ('CLOSED','CLOSED_FINAL','MERGED_DUPLICATE','PENDING_LEDGER') order by created_at desc limit 1) end, $7)
         on conflict (family, subject, day) do update set score = excluded.score, features = excluded.features,
           explanation = excluded.explanation, case_id = coalesce(anomalies.case_id, excluded.case_id), detected_at = excluded.detected_at`,
        [family, r.subject, r.day, r.score, JSON.stringify(featuresOf.get(`${r.subject}|${r.day}`) ?? {}), JSON.stringify(r.explanation), deps.now()]);
      counts[family]++;
    }
  }
  return counts;
}

export async function listAnomalies(deps: AppDeps, family: AnomalyFamily | undefined, days: number) {
  const { rows } = await deps.pool.query(
    `select id, family, subject, to_char(day, 'YYYY-MM-DD') as day, score, features, explanation, case_id as "caseId", detected_at as "detectedAt"
     from anomalies where ($1::text is null or family = $1) and day > ($2::timestamptz - make_interval(days => $3))::date
     order by score desc limit 200`, [family ?? null, deps.now(), days]);
  return rows;
}
