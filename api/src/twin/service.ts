import { createHash } from 'node:crypto';
import type { AppDeps } from '../app.js';
import { notFound } from '../errors.js';
import { normalReading } from '../seed/domain.js';

const HOUR = 3600e3;
const OPEN = `status not in ('CLOSED','CLOSED_FINAL','MERGED_DUPLICATE','PENDING_LEDGER')`;
const OUT_OF_BOUNDS = '(s.rh_pct > l.rh_max or s.temp_c > l.temp_max or s.temp_c < l.temp_min)';

export interface Bay {
  id: string; temp: number | null; rh: number | null; readingAt: Date | null; inBoundsNow: boolean;
  excursionHours7d: number; openCases: number; lots: number; anomalies7d: number;
}

/** Live state of every bay, grouped depot → magazine → bay. Store officers see their own depot only. */
export async function twinState(deps: AppDeps, depot: string | null) {
  const { rows } = await deps.pool.query(
    `select l.id, l.depot_id, s.temp_c, s.rh_pct, s.ts,
            (s.ts is null or not (s.rh_pct > l.rh_max or s.temp_c > l.temp_max or s.temp_c < l.temp_min)) as in_bounds,
            (select count(*)::int from sensor_readings s, locations x where x.id = l.id and s.location_id = l.id
               and s.ts > $2::timestamptz - interval '7 days' and (s.rh_pct > x.rh_max or s.temp_c > x.temp_max or s.temp_c < x.temp_min)) as excursion_hours,
            (select count(*)::int from cases c where c.location_ref = l.id and c.${OPEN}) as open_cases,
            (select count(*)::int from assets a where a.current_location = l.id) as lots,
            (select count(*)::int from anomalies a where a.subject = l.id and a.day > ($2::timestamptz - interval '7 days')::date) as anomalies
     from locations l
     left join lateral (select * from sensor_readings r where r.location_id = l.id order by r.ts desc limit 1) s on true
     where $1::text is null or l.depot_id = $1
     order by l.id`, [depot, deps.now()]);
  const depots = new Map<string, Map<string, Bay[]>>();
  for (const r of rows) {
    const [d, m] = r.id.split('/');
    const mags = depots.get(d) ?? new Map<string, Bay[]>();
    depots.set(d, mags);
    mags.set(m, [...(mags.get(m) ?? []), {
      id: r.id, temp: r.temp_c, rh: r.rh_pct, readingAt: r.ts, inBoundsNow: r.in_bounds,
      excursionHours7d: r.excursion_hours, openCases: r.open_cases, lots: r.lots, anomalies7d: r.anomalies,
    }]);
  }
  return [...depots].map(([id, mags]) => ({ id, magazines: [...mags].map(([mid, bays]) => ({ id: `${id}/${mid}`, bays })) }));
}

export async function twinLocation(deps: AppDeps, id: string) {
  const q = async (sql: string, p: unknown[]) => (await deps.pool.query(sql, p)).rows;
  const [loc] = await q('select * from locations where id = $1', [id]);
  if (!loc) throw notFound('location');
  return {
    location: { id: loc.id, depot: loc.depot_id, tempMin: loc.temp_min, tempMax: loc.temp_max, rhMax: loc.rh_max },
    readings: await q(`select s.ts, s.temp_c as temp, s.rh_pct as rh, ${OUT_OF_BOUNDS} as "outOfBounds"
                       from sensor_readings s join locations l on l.id = s.location_id
                       where s.location_id = $1 and s.ts > $2::timestamptz - interval '7 days' order by s.ts`, [id, deps.now()]),
    lots: await q('select id, item_type as "itemType", quantity, manufactured_on as "manufacturedOn", shelf_life_months as "shelfLifeMonths" from assets where current_location = $1 order by id', [id]),
    events: await q(`select id, asset_id as "assetId", event_type as "eventType", actor_pseudo as "actorPseudo", occurred_at as "occurredAt" from lifecycle_events
                     where to_location = $1 or from_location = $1 or asset_id in (select id from assets where current_location = $1)
                     order by occurred_at desc limit 10`, [id]),
    cases: await q(`select case_id as "caseId", status, category, risk_level as "riskLevel" from cases where location_ref = $1 and ${OPEN} order by created_at desc`, [id]),
    anomalies: await q(`select id, family, day, score, explanation from anomalies where subject = $1 order by day desc limit 5`, [id]),
  };
}

/**
 * Sensor simulator for the digital twin: appends normal hourly readings for every location up to the current hour,
 * so the twin stays live after seeding. Deterministic per (location, hour). Returns the number of readings added.
 */
export async function fillSensorReadings(deps: AppDeps): Promise<number> {
  const nowHour = Math.floor(deps.now().getTime() / HOUR) * HOUR;
  const { rows } = await deps.pool.query('select l.id, max(s.ts) as last from locations l left join sensor_readings s on s.location_id = l.id group by l.id');
  const loc: string[] = [], ts: Date[] = [], temp: number[] = [], rh: number[] = [];
  for (const r of rows) {
    const from = Math.max(r.last ? new Date(r.last).getTime() + HOUR : 0, nowHour - 14 * 24 * HOUR);
    for (let t = from; t <= nowHour; t += HOUR) {
      const h = createHash('sha256').update(`${r.id}|${t}`).digest();
      const x = normalReading(t, h[0] / 256, h[1] / 256);
      loc.push(r.id); ts.push(new Date(t)); temp.push(x.temp); rh.push(x.rh);
    }
  }
  if (loc.length) {
    await deps.pool.query(`insert into sensor_readings(location_id, ts, temp_c, rh_pct)
                           select * from unnest($1::text[], $2::timestamptz[], $3::real[], $4::real[]) on conflict do nothing`, [loc, ts, temp, rh]);
  }
  return loc.length;
}
