import type pg from 'pg';
import type { Config } from '../config.js';
import type { Ledger } from './ledger.js';

export async function makeLedger(cfg: Config, pool: pg.Pool): Promise<Ledger> {
  if (cfg.LEDGER_MODE === 'fabric') {
    const { FabricLedger } = await import('./fabricLedger.js');
    return new FabricLedger(cfg);
  }
  if (cfg.LEDGER_MODE === 'postgres') {
    const { PostgresLedger } = await import('./postgresLedger.js');
    console.warn('LEDGER_MODE=postgres: centralised-database baseline, no blockchain');
    return new PostgresLedger(pool, () => new Date());
  }
  const { FakeLedger } = await import('./fakeLedger.js');
  console.warn('LEDGER_MODE=fake: in-memory ledger, state is lost on restart');
  return new FakeLedger(() => new Date());
}
