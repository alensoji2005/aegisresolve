import type { Config } from '../config.js';
import type { Ledger } from './ledger.js';

export async function makeLedger(cfg: Config): Promise<Ledger> {
  if (cfg.LEDGER_MODE === 'fabric') {
    const { FabricLedger } = await import('./fabricLedger.js');
    return new FabricLedger(cfg);
  }
  const { FakeLedger } = await import('./fakeLedger.js');
  console.warn('LEDGER_MODE=fake: in-memory ledger, state is lost on restart');
  return new FakeLedger(() => new Date());
}
