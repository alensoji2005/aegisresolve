import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers, type Gateway } from '@hyperledger/fabric-gateway';
import type { Config } from '../config.js';
import { orgFor, orgInfo, type OrgKey } from './fabricOrgs.js';
import { type Ledger, LedgerError, type LedgerUser } from './ledger.js';

const MVCC_READ_CONFLICT = 11; // fabric-protos TxValidationCode
const decoder = new TextDecoder();

const parse = (bytes: Uint8Array) => {
  const s = decoder.decode(bytes);
  try { return JSON.parse(s); } catch { return s; }
};

/** Fabric Gateway adapter: every call is signed with the acting user's own enrolled key. */
export class FabricLedger implements Ledger {
  private clients = new Map<OrgKey, grpc.Client>();

  constructor(private cfg: Config) {}

  private client(key: OrgKey): grpc.Client {
    let c = this.clients.get(key);
    if (!c) {
      const o = orgInfo(this.cfg, key);
      c = new grpc.Client(o.peerEndpoint, grpc.credentials.createSsl(readFileSync(o.peerTlsCertPath)), {
        'grpc.ssl_target_name_override': o.peerHostAlias,
      });
      this.clients.set(key, c);
    }
    return c;
  }

  private async withContract<T>(user: LedgerUser, fn: string, run: (contract: ReturnType<ReturnType<Gateway['getNetwork']>['getContract']>, name: string) => Promise<T>): Promise<T> {
    if (!user.certPem || !user.keyPem) throw new LedgerError('FORBIDDEN', `user ${user.userId} has no Fabric identity`);
    const [contractName, name] = fn.split(':');
    const key = orgFor(user.role);
    const gateway = connect({
      client: this.client(key),
      identity: { mspId: orgInfo(this.cfg, key).mspId, credentials: Buffer.from(user.certPem) },
      signer: signers.newPrivateKeySigner(createPrivateKey(user.keyPem)),
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
      submitOptions: () => ({ deadline: Date.now() + 5_000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
    });
    try {
      const contract = gateway.getNetwork(this.cfg.FABRIC_CHANNEL).getContract(this.cfg.FABRIC_CHAINCODE, contractName);
      return await run(contract, name);
    } catch (e: any) {
      if (e instanceof LedgerError) throw e;
      if (e?.code === grpc.status.UNAVAILABLE || e?.cause?.code === grpc.status.UNAVAILABLE) throw new LedgerError('UNAVAILABLE', 'ledger unavailable');
      throw LedgerError.from(e);
    } finally {
      gateway.close();
    }
  }

  submit<T>(user: LedgerUser, fn: string, args: string[]) {
    return this.withContract(user, fn, async (contract, name) => {
      const commit = await contract.submitAsync(name, { arguments: args });
      const result = parse(commit.getResult()) as T;
      const status = await commit.getStatus();
      if (!status.successful) {
        throw new LedgerError(status.code === MVCC_READ_CONFLICT ? 'MVCC_READ_CONFLICT' : 'LEDGER_ERROR',
          `transaction ${status.transactionId} failed to commit with code ${status.code}`);
      }
      return { txId: commit.getTransactionId(), result };
    });
  }

  evaluate<T>(user: LedgerUser, fn: string, args: string[]) {
    return this.withContract(user, fn, async (contract, name) => parse(await contract.evaluateTransaction(name, ...args)) as T);
  }

  close() {
    for (const c of this.clients.values()) c.close();
  }
}
