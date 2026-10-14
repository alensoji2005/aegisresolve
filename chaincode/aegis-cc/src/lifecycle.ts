import { Context, Contract, Info, Transaction } from 'fabric-contract-api';
import { actorOf, check, fail, getJson, listByPrefix, putJson, RE, requireRole, txTime } from './ctxutil';
import { EVENT_TYPES, EventType, LifecycleEvent } from './types';

@Info({ title: 'LifecycleContract', description: 'Synthetic asset lifecycle and custody events' })
export class LifecycleContract extends Contract {
  constructor() {
    super('lifecycle');
  }

  @Transaction()
  async recordEvent(ctx: Context, eventId: string, assetRef: string, eventType: string, fromLocation: string, toLocation: string,
    quantity: string, actorPseudo: string, actorUnit: string, occurredAt: string, payloadHash: string): Promise<string> {
    const actor = requireRole(ctx, 'STORE_OFFICER', 'SYSTEM');
    check(RE.event.test(eventId), 'eventId');
    check(RE.lot.test(assetRef), 'assetRef');
    check(EVENT_TYPES.includes(eventType as EventType), 'eventType');
    for (const [n, l] of [['fromLocation', fromLocation], ['toLocation', toLocation]]) check(l === '' || RE.location.test(l), n);
    const qty = Number(quantity);
    check(Number.isInteger(qty) && qty >= 0, 'quantity');
    check(actorPseudo.length > 0 && actorUnit.length > 0, 'actor');
    const at = Date.parse(occurredAt);
    check(!Number.isNaN(at), 'occurredAt');
    check(RE.hash.test(payloadHash), 'payloadHash');
    if (await getJson(ctx, 'EVT', [eventId])) fail('ALREADY_EXISTS', eventId);
    const prior = await listByPrefix<LifecycleEvent>(ctx, 'EVTASSET', [assetRef]);
    if (prior.some((e) => e.eventType === 'DISPOSAL')) fail('INVALID_TRANSITION', `${assetRef} already disposed`);
    const ev: LifecycleEvent = {
      docType: 'event', eventId, assetRef, eventType: eventType as EventType,
      fromLocation: fromLocation || null, toLocation: toLocation || null, quantity: qty, actorPseudo, actorUnit,
      occurredAt: new Date(at).toISOString(), payloadHash, recordedBy: `${actor.role}:${actor.id}`,
    };
    await putJson(ctx, 'EVT', [eventId], ev);
    await putJson(ctx, 'EVTASSET', [assetRef, ev.occurredAt, eventId], ev);
    ctx.stub.setEvent('LifecycleEventRecorded', Buffer.from(JSON.stringify({ eventId, assetRef, at: txTime(ctx).toISOString() })));
    return JSON.stringify(ev);
  }

  @Transaction(false)
  async getEvent(ctx: Context, eventId: string): Promise<string> {
    actorOf(ctx);
    const e = await getJson<LifecycleEvent>(ctx, 'EVT', [eventId]);
    if (!e) fail('NOT_FOUND', eventId);
    return JSON.stringify(e);
  }

  @Transaction(false)
  async getAssetHistory(ctx: Context, assetRef: string): Promise<string> {
    requireRole(ctx, 'INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR', 'STORE_OFFICER', 'SYSTEM');
    check(RE.lot.test(assetRef), 'assetRef');
    return JSON.stringify(await listByPrefix<LifecycleEvent>(ctx, 'EVTASSET', [assetRef]));
  }
}
