import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import { getServerConfig } from '../config/env';

export interface StorageBackend {
  upload(key: string, data: Buffer, options?: { contentType?: string }): Promise<string>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  getPresignedUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string>;
  storageUriForKey(key: string): string;
  headObject(key: string): Promise<{ contentLength: number } | null>;
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
    // Strip s3://bucket/ prefix if present (fileUrl stored as full URI)
    const objectKey = key.startsWith(`s3://${this.bucket}/`)
      ? key.slice(`s3://${this.bucket}/`.length)
      : key;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    return await getSignedUrl(this.client, command, { expiresIn });
  }

  async getPresignedUploadUrl(key: string, contentType: string, expiresIn = 900): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return await getSignedUrl(this.client, command, { expiresIn });
  }

  storageUriForKey(key: string): string {
    return `s3://${this.bucket}/${key}`;
  }

  async headObject(key: string): Promise<{ contentLength: number } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return { contentLength: result.ContentLength ?? 0 };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || status === 403) return null;
      throw err;
    }
  }
}

class LocalStorage implements StorageBackend {
  private uploadDir = './uploads';

  // Resolves key against the uploads root and rejects any path that would escape it
  // via `..` segments. join() alone happily resolves a traversal outside the intended
  // directory, so callers upstream that only check a string prefix (e.g.
  // submissions.router.ts's submitFromKeys) are not a sufficient guard by themselves --
  // this must hold regardless of what the caller already checked. Mirrors the same
  // containment check already used in app.ts's `/uploads-local` PUT handler.
  private resolveKeyPath(key: string): string | null {
    const root = resolve(this.uploadDir);
    const resolved = resolve(root, key);
    if (resolved !== root && !resolved.startsWith(root + sep)) return null;
    return resolved;
  }

  async upload(key: string, data: Buffer): Promise<string> {
    const filePath = this.resolveKeyPath(key);
    if (!filePath) throw new Error(`Refusing to write outside the uploads directory: ${key}`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return `file://${filePath}`;
  }

  async getPresignedUrl(key: string): Promise<string> {
    const stripped = key.replace(/^file:\/\//, '');

    // upload()/storageUriForKey() always return an absolute path (resolveKeyPath()
    // resolves against the uploads root before either ever returns), and that's
    // exactly what round-trips back into this function on the preview/download path.
    // The string-prefix match below only ever matches a *relative* key, so an
    // absolute one silently fell through unmodified -- leaking the raw filesystem
    // path into the served URL (a doubled `/uploads//home/...` 404) instead of being
    // rebased against the real uploads root. Handle that case explicitly first.
    if (isAbsolute(stripped)) {
      const root = resolve(this.uploadDir);
      const rel = relative(root, stripped);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Refusing to serve a path outside the uploads directory: ${key}`);
      }
      return `http://localhost:3000/uploads/${rel}`;
    }

    const uploadPrefix = this.uploadDir.replace(/^\.\//, '').replace(/\/+$/, '');
    let objectKey = stripped.replace(/^\.\//, '');
    if (objectKey.startsWith(`${uploadPrefix}/`)) {
      objectKey = objectKey.slice(uploadPrefix.length + 1);
    }
    return `http://localhost:3000/uploads/${objectKey}`;
  }

  async getPresignedUploadUrl(
    key: string,
    _contentType: string,
    _expiresIn?: number
  ): Promise<string> {
    // In local dev, route PUT uploads to the dedicated Express handler in app.ts
    return `http://localhost:3000/uploads-local/${encodeURIComponent(key)}`;
  }

  storageUriForKey(key: string): string {
    const filePath = this.resolveKeyPath(key);
    if (!filePath)
      throw new Error(`Refusing to resolve a URI outside the uploads directory: ${key}`);
    return `file://${filePath}`;
  }

  async headObject(key: string): Promise<{ contentLength: number } | null> {
    const { stat } = await import('fs/promises');
    const filePath = this.resolveKeyPath(key);
    if (!filePath) return null;
    try {
      const s = await stat(filePath);
      return { contentLength: s.size };
    } catch {
      return null;
    }
  }
}

export function getStorageBackend(): StorageBackend {
  const config = getServerConfig();
  if (config.NODE_ENV === 'production') {
    return new S3Storage();
  }
  return new LocalStorage();
}
