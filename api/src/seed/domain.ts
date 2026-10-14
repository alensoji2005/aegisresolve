import type { EventType } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { canonicalJson, sha256Hex } from '../crypto.js';
import { systemUser } from '../users/service.js';
import { int, pick, type Rnd } from './prng.js';

const DAY = 864e5;
const HOUR = 3600e3;
export const DEMO_LOT = 'LOT-B03-2025-0117';
export const DEMO_LOCATION = 'DEP-02/MAG-01/BAY-04';
export const EXCURSION_MAGAZINE = 'DEP-02/MAG-01';
export const DISCREPANCY_LOTS = ['LOT-B03-2025-0117', 'LOT-A01-2025-0007', 'LOT-B03-2025-0125'];

interface SeedEvent {
  id?: string; asset: string; type: EventType; from: string | null; to: string | null; qty: number; actor: string; unit: string; at: Date;
  payload: Record<string, unknown>;
}

export function buildDomain(rnd: Rnd, now: Date) {
  const depots = ['DEP-01', 'DEP-02'];
  const locations = depots.flatMap((d) => ['MAG-01', 'MAG-02'].flatMap((m) => ['BAY-01', 'BAY-02', 'BAY-03', 'BAY-04'].map((b) => `${d}/${m}/${b}`)));
  const personnel = Array.from({ length: 12 }, (_, i) => ({ pseudo: `PER-${101 + i}`, unit: `U${(i % 3) + 1}`, depot: depots[i % 2] }));
  const lots = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `LOT-A01-2025-${String(i + 1).padStart(4, '0')}`, depot: 'DEP-01' })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `LOT-B03-2025-${String(i + 101).padStart(4, '0')}`, depot: 'DEP-02' })),
  ];
  const assets = lots.map((l, i) => {
    const expired = i % 16 === 3; // 5 lots already past shelf life
    const loc = l.id === DEMO_LOT ? DEMO_LOCATION : pick(rnd, locations.filter((x) => x.startsWith(l.depot)));
    return {
      id: l.id, itemType: `ITEM-TYPE-${String(int(rnd, 1, 12)).padStart(2, '0')}`, quantity: int(rnd, 50, 400),
      manufacturedOn: expired ? '2018-03-01' : `${int(rnd, 2019, 2025)}-${String(int(rnd, 1, 12)).padStart(2, '0')}-01`,
      shelfLifeMonths: expired ? 24 : int(rnd, 60, 120), location: loc, depot: l.depot,
    };
  });

  const events: SeedEvent[] = [];
  const start = now.getTime() - 60 * DAY;
  for (const a of assets) {
    const staff = personnel.filter((p) => p.depot === a.depot);
    const who = () => pick(rnd, staff);
    let t = start + int(rnd, 0, 5) * DAY + int(rnd, 7, 16) * HOUR;
    let p = who();
    events.push({ asset: a.id, type: 'RECEIPT', from: null, to: a.location, qty: a.quantity, actor: p.pseudo, unit: p.unit, at: new Date(t), payload: {} });
    let loc = a.location;
    for (let k = int(rnd, 3, 7); k > 0; k--) {
      t += int(rnd, 2, 9) * DAY + int(rnd, 0, 8) * HOUR;
      if (t > now.getTime() - DAY) break;
      const type = pick(rnd, ['ISSUE', 'RETURN', 'STORAGE_MOVE', 'INSPECTION', 'ISSUE', 'RETURN'] as const);
      p = who();
      if (type === 'STORAGE_MOVE' && a.id !== DEMO_LOT) {
        const next = pick(rnd, locations.filter((x) => x.startsWith(a.depot) && x !== loc));
        events.push({ asset: a.id, type, from: loc, to: next, qty: a.quantity, actor: p.pseudo, unit: p.unit, at: new Date(t), payload: {} });
        loc = next;
      } else {
        events.push({ asset: a.id, type: type === 'STORAGE_MOVE' ? 'INSPECTION' : type, from: type === 'ISSUE' ? loc : null,
          to: type === 'RETURN' ? loc : null, qty: type === 'INSPECTION' || type === 'STORAGE_MOVE' ? 0 : int(rnd, 1, 20),
          actor: p.pseudo, unit: p.unit, at: new Date(t), payload: {} });
      }
    }
    a.location = loc;
    for (const d of [46, 32, 18, 4]) {
      p = who();
      const discrepancy = DISCREPANCY_LOTS.includes(a.id) && d === 4 ? -4 : 0;
      events.push({ asset: a.id, type: 'RECONCILIATION', from: null, to: null, qty: a.quantity + discrepancy, actor: p.pseudo, unit: p.unit,
        at: new Date(now.getTime() - d * DAY + int(rnd, 8, 12) * HOUR), payload: { discrepancy } });
    }
  }
  events.sort((x, y) => x.at.getTime() - y.at.getTime() || (x.asset < y.asset ? -1 : 1));
  events.forEach((e, i) => { e.id = `EVT-${String(i + 1).padStart(6, '0')}`; });

  const readings: { location: string; ts: Date; temp: number; rh: number }[] = [];
  const hourNow = Math.floor(now.getTime() / HOUR) * HOUR;
  const excursionStart = hourNow - 6 * DAY;
  for (const l of locations) {
    for (let h = 14 * 24; h > 0; h--) {
      const ts = hourNow - h * HOUR;
      const daily = Math.sin((2 * Math.PI * ((ts / HOUR) % 24)) / 24);
      const excursion = l.startsWith(EXCURSION_MAGAZINE) && ts >= excursionStart && ts < excursionStart + 48 * HOUR;
      readings.push({ location: l, ts: new Date(ts), temp: round(19 + 4 * daily + (rnd() - 0.5)),
        rh: excursion ? 85 : round(55 + 6 * daily + (rnd() - 0.5) * 4) });
    }
  }
  return { depots, locations, personnel, assets, events: events as Required<SeedEvent>[], readings };
}

const round = (x: number) => Math.round(x * 10) / 10;

export async function seedDomain(deps: AppDeps, rnd: Rnd): Promise<{ events: number; readings: number }> {
  const d = buildDomain(rnd, deps.now());
  const q = (sql: string, args: unknown[]) => deps.pool.query(sql, args);
  await q(`insert into depots(id, name) select unnest($1::text[]), 'Depot ' || unnest($1::text[])`, [d.depots]);
  await q(`insert into locations(id, depot_id, temp_min, temp_max, rh_max) select l, left(l, 6), 5, 30, 70 from unnest($1::text[]) l`, [d.locations]);
  await q(`insert into personnel(pseudo_id, unit_id, depot_id) select * from unnest($1::text[], $2::text[], $3::text[])`,
    [d.personnel.map((p) => p.pseudo), d.personnel.map((p) => p.unit), d.personnel.map((p) => p.depot)]);
  await q(`insert into assets(id, item_type, quantity, manufactured_on, shelf_life_months, current_location)
           select * from unnest($1::text[], $2::text[], $3::int[], $4::date[], $5::int[], $6::text[])`,
    [d.assets.map((a) => a.id), d.assets.map((a) => a.itemType), d.assets.map((a) => a.quantity), d.assets.map((a) => a.manufacturedOn),
      d.assets.map((a) => a.shelfLifeMonths), d.assets.map((a) => a.location)]);
  await q(`insert into sensor_readings(location_id, ts, temp_c, rh_pct) select * from unnest($1::text[], $2::timestamptz[], $3::real[], $4::real[])`,
    [d.readings.map((r) => r.location), d.readings.map((r) => r.ts), d.readings.map((r) => r.temp), d.readings.map((r) => r.rh)]);

  // Events of one asset go in order (the chaincode range-reads an asset's history); different assets run in parallel.
  const sys = await systemUser(deps);
  const byAsset = new Map<string, typeof d.events>();
  for (const e of d.events) byAsset.set(e.asset, [...(byAsset.get(e.asset) ?? []), e]);
  await Promise.all([...byAsset.values()].map(async (list) => {
    for (const e of list) {
      const { txId } = await deps.ledger.submit(sys, 'lifecycle:recordEvent', [e.id, e.asset, e.type, e.from ?? '', e.to ?? '', String(e.qty),
        e.actor, e.unit, e.at.toISOString(), sha256Hex(canonicalJson(e.payload))]);
      await q(`insert into lifecycle_events(id, asset_id, event_type, from_location, to_location, quantity, actor_pseudo, actor_unit, occurred_at, payload, ledger_tx_id)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [e.id, e.asset, e.type, e.from, e.to, e.qty, e.actor, e.unit, e.at, JSON.stringify(e.payload), txId]);
    }
  }));
  return { events: d.events.length, readings: d.readings.length };
}
