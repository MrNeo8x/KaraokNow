import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { del, get, put } from '@vercel/blob';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

export type StorageAccess = 'public' | 'private';
export type StorageBackend = 'VERCEL_BLOB' | 'LOCAL';
export interface StoredObject { pathname: string; url: string; backend: StorageBackend }
export interface ReadObject { stream: Readable; contentType: string; size: number }

const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/;

/**
 * PD-037 object storage. Vercel Blob in deployed environments (one public store, one private store, explicit token per
 * call because a project may be connected to both); a local directory for development and tests. On Vercel without the
 * matching token, writes fail with 503 instead of silently using the ephemeral function filesystem.
 */
@Injectable()
export class ObjectStorageService {
  backendFor(access: StorageAccess): StorageBackend | null {
    if (this.token(access)) return 'VERCEL_BLOB';
    return process.env.VERCEL ? null : 'LOCAL';
  }

  async put(access: StorageAccess, pathname: string, body: Buffer, contentType: string): Promise<StoredObject> {
    this.assertPath(pathname);
    const backend = this.requireBackend(access);
    if (backend === 'VERCEL_BLOB') {
      const result = await put(pathname, body, { access, token: this.token(access)!, contentType, addRandomSuffix: false, allowOverwrite: false });
      return { pathname: result.pathname, url: result.url, backend };
    }
    const file = this.localFile(access, pathname);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body, { flag: 'wx' });
    return { pathname, url: access === 'public' ? `/v1/files/public/${pathname}` : `local-private:${pathname}`, backend };
  }

  async read(access: StorageAccess, pathname: string, backend: StorageBackend, contentType: string): Promise<ReadObject> {
    this.assertPath(pathname);
    if (backend === 'VERCEL_BLOB') {
      const token = this.token(access);
      if (!token) throw new ServiceUnavailableException(`${access} file storage is not configured`);
      const result = await get(pathname, { access, token });
      if (!result || !result.stream) throw new NotFoundException('File not found');
      return { stream: Readable.fromWeb(result.stream as never), contentType: result.blob.contentType ?? contentType, size: result.blob.size };
    }
    const file = this.localFile(access, pathname);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('File not found');
    return { stream: createReadStream(file), contentType, size: info.size };
  }

  /** Best effort: a missing object is not an error. */
  async remove(access: StorageAccess, pathname: string, backend: StorageBackend): Promise<void> {
    this.assertPath(pathname);
    if (backend === 'VERCEL_BLOB') {
      const token = this.token(access);
      if (!token) throw new ServiceUnavailableException(`${access} file storage is not configured`);
      await del(pathname, { token });
      return;
    }
    await rm(this.localFile(access, pathname), { force: true });
  }

  /** Local public files are served by FilesController; Blob URLs are served by Vercel's CDN. */
  localPublicFile(pathname: string): string | null {
    if (this.backendFor('public') !== 'LOCAL' || !SAFE_PATH.test(pathname)) return null;
    return this.localFile('public', pathname);
  }

  private token(access: StorageAccess): string | undefined {
    return access === 'public'
      ? process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || undefined
      : process.env.BLOB_PRIVATE_READ_WRITE_TOKEN || undefined;
  }

  private requireBackend(access: StorageAccess): StorageBackend {
    const backend = this.backendFor(access);
    if (!backend) throw new ServiceUnavailableException(`${access} file storage is not configured`);
    return backend;
  }

  private localFile(access: StorageAccess, pathname: string): string {
    const root = resolve(process.env.STORAGE_LOCAL_DIR || join(process.cwd(), '.storage'), access);
    const file = resolve(root, pathname);
    if (!file.startsWith(root + sep)) throw new NotFoundException('File not found');
    return file;
  }

  private assertPath(pathname: string): void {
    if (!SAFE_PATH.test(pathname)) throw new NotFoundException('File not found');
  }
}
