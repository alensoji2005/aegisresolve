import { beforeEach, describe, expect, it } from 'vitest';
import { at, h, Harness, people } from './harness';

let x: Harness;
beforeEach(() => { x = new Harness(); });

describe('LifecycleContract', () => {
  it('records and retrieves an event', async () => {
    await x.event('EVT-000001', 'U1', 'PER-101', at(-5));
    expect(JSON.parse(await x.lc.getEvent(x.ctx(people.inv), 'EVT-000001'))).toMatchObject({ actorUnit: 'U1', fromLocation: null, quantity: 10 });
  });

  it('asset history is ordered by occurredAt', async () => {
    await x.event('EVT-000002', 'U1', 'PER-101', at(-1));
    await x.event('EVT-000001', 'U1', 'PER-101', at(-5));
    const hist = JSON.parse(await x.lc.getAssetHistory(x.ctx(people.inv), 'LOT-B03-2025-0117'));
    expect(hist.map((e: any) => e.eventId)).toEqual(['EVT-000001', 'EVT-000002']);
  });

  it('event after DISPOSAL -> INVALID_TRANSITION', async () => {
    await x.event('EVT-000001', 'U1', 'PER-101', at(-5), 'DISPOSAL');
    await expect(x.event('EVT-000002', 'U1', 'PER-101', at(-1))).rejects.toThrow(/^INVALID_TRANSITION/);
  });

  it('COMPLAINANT cannot record', async () => {
    await expect(x.lc.recordEvent(x.ctx(people.comp), 'EVT-000001', 'LOT-B03-2025-0117', 'ISSUE', '', '', '1', 'P', 'U', at(0).toISOString(), h('p')))
      .rejects.toThrow(/^FORBIDDEN/);
  });

  it('negative quantity -> INVALID_ARG', async () => {
    await expect(x.lc.recordEvent(x.ctx(people.sys), 'EVT-000001', 'LOT-B03-2025-0117', 'ISSUE', '', '', '-1', 'P', 'U', at(0).toISOString(), h('p')))
      .rejects.toThrow(/^INVALID_ARG/);
  });
});
