import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { DetectedType, MAX_UPLOAD_BYTES, detectFileType } from './file-type';

/** Subset of the multer memory-storage file object used here (avoids a @types/multer dependency). */
export interface UploadedFileLike { buffer: Buffer; size: number }

/** Multer options for single-file uploads: in memory, ≤ 4 MB (below Vercel's 4.5 MB function body limit). */
export const UPLOAD_LIMITS = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } };

export function requireFile(file: UploadedFileLike | undefined, allowed: readonly DetectedType[]): { buffer: Buffer; type: DetectedType } {
  if (!file?.buffer?.length) throw new BadRequestException('A file is required in the multipart field "file"');
  const type = detectFileType(file.buffer);
  if (!type || !allowed.includes(type)) throw new UnprocessableEntityException(`File type not allowed; accepted: ${allowed.join(', ')}`);
  return { buffer: file.buffer, type };
}
