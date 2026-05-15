import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { getServerConfig } from '../config/env';

export interface StorageBackend {
  upload(key: string, data: Buffer, options?: { contentType?: string }): Promise<string>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
}

class S3Storage implements StorageBackend {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const config = getServerConfig();
    this.client = new S3Client({
      region: config.AWS_REGION!,
      endpoint: config.AWS_ENDPOINT_URL!,
    });
    this.bucket = config.AWS_S3_BUCKET!;
  }

  async upload(key: string, data: Buffer, options?: { contentType?: string }): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: options?.contentType ?? 'application/octet-stream',
      })
    );
    return `s3://${this.bucket}/${key}`;
  }

  async getPresignedUrl(key: string, expiresIn = 300): Promise<string> {
    // Storage URIs are stored as s3://bucket/key where the key already
    // includes the bucket name as a path prefix (e.g. taskmarket/submissions/...).
    // Strip only the s3:// scheme prefix; the remainder is the full object key.
    const objectKey = key.startsWith('s3://') ? key.slice('s3://'.length) : key;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    return await getSignedUrl(this.client, command, { expiresIn });
  }
}

class LocalStorage implements StorageBackend {
  private uploadDir = './uploads';

  async upload(key: string, data: Buffer): Promise<string> {
    const filePath = join(this.uploadDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return `file://${filePath}`;
  }

  async getPresignedUrl(key: string): Promise<string> {
    const uploadPrefix = this.uploadDir.replace(/^\.\//, '').replace(/\/+$/, '');
    let objectKey = key.replace(/^file:\/\//, '').replace(/^\.\//, '');
    if (objectKey.startsWith(`${uploadPrefix}/`)) {
      objectKey = objectKey.slice(uploadPrefix.length + 1);
    }
    return `http://localhost:3000/uploads/${objectKey}`;
  }
}

export function getStorageBackend(): StorageBackend {
  const config = getServerConfig();
  if (config.NODE_ENV === 'production') {
    return new S3Storage();
  }
  return new LocalStorage();
}
