import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config.js';

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class MemoryBlobStore implements BlobStore {
  readonly items = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.items.set(key, Buffer.from(data)); }
  async get(key: string) {
    const v = this.items.get(key);
    if (!v) throw new Error('NOT_FOUND: blob ' + key);
    return Buffer.from(v);
  }
  async delete(key: string) { this.items.delete(key); }
}

export class S3BlobStore implements BlobStore {
  private s3: S3Client;
  private ready: Promise<void> | null = null;

  constructor(private cfg: Config) {
    this.s3 = new S3Client({
      endpoint: cfg.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
    });
  }

  private ensureBucket() {
    this.ready ??= this.s3.send(new HeadBucketCommand({ Bucket: this.cfg.S3_BUCKET }))
      .then(() => undefined)
      .catch(() => this.s3.send(new CreateBucketCommand({ Bucket: this.cfg.S3_BUCKET })).then(() => undefined));
    return this.ready;
  }

  async put(key: string, data: Buffer) {
    await this.ensureBucket();
    await this.s3.send(new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, Body: data }));
  }

  async get(key: string) {
    await this.ensureBucket();
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async delete(key: string) {
    await this.ensureBucket();
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
  }
}
