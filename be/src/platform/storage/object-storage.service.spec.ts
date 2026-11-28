import { ObjectStorageService } from './object-storage.service';

describe('ObjectStorageService backend selection (PD-037)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  const clear = () => { for (const k of ['VERCEL', 'BLOB_PUBLIC_READ_WRITE_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'BLOB_PRIVATE_READ_WRITE_TOKEN']) delete process.env[k]; };

  it('uses Vercel Blob per store when its token is configured', () => {
    clear(); process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_public'; process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = 'vercel_blob_rw_private';
    const storage = new ObjectStorageService();
    expect(storage.backendFor('public')).toBe('VERCEL_BLOB');
    expect(storage.backendFor('private')).toBe('VERCEL_BLOB');
  });

  it('refuses to fall back to the function filesystem on Vercel without a token', () => {
    clear(); process.env.VERCEL = '1'; process.env.BLOB_PUBLIC_READ_WRITE_TOKEN = 'vercel_blob_rw_public';
    const storage = new ObjectStorageService();
    expect(storage.backendFor('public')).toBe('VERCEL_BLOB');
    expect(storage.backendFor('private')).toBeNull();
  });

  it('uses the local directory outside Vercel and rejects path traversal', async () => {
    clear();
    const storage = new ObjectStorageService();
    expect(storage.backendFor('public')).toBe('LOCAL');
    expect(storage.localPublicFile('../etc/passwd')).toBeNull();
    await expect(storage.put('public', 'rooms/../../x.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow('File not found');
  });
});
