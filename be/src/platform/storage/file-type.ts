/**
 * PD-037: detect the real file type from its first bytes. The client's Content-Type and file name are never trusted.
 */
export type DetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export const IMAGE_TYPES: readonly DetectedType[] = ['image/jpeg', 'image/png', 'image/webp'];
export const PDF_TYPES: readonly DetectedType[] = ['application/pdf'];
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const EXTENSIONS: Record<DetectedType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export function detectFileType(buffer: Buffer): DetectedType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
