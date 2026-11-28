import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { EXTENSIONS, DetectedType } from './file-type';
import { ObjectStorageService } from './object-storage.service';

const CONTENT_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type])) as Record<string, DetectedType>;

/** Serves public files when the LOCAL storage backend is active (development/tests). Deployed public files are Blob URLs. */
@ApiExcludeController()
@Controller('files/public')
export class FilesController {
  constructor(private readonly storage: ObjectStorageService) {}

  @Get('*path')
  serve(@Req() request: Request, @Res() response: Response) {
    const raw = (request.params as Record<string, string | string[]>).path;
    const pathname = Array.isArray(raw) ? raw.join('/') : raw;
    const file = this.storage.localPublicFile(pathname);
    if (!file || !existsSync(file)) throw new NotFoundException('File not found');
    const type = CONTENT_TYPES[pathname.split('.').pop() ?? ''];
    if (!type) throw new NotFoundException('File not found');
    response.setHeader('Content-Type', type);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // The default directory is `.storage`; express `send` refuses dot-paths unless told otherwise (was a 500 locally).
    // Traversal is already blocked by SAFE_PATH in localPublicFile.
    response.sendFile(file, { dotfiles: 'allow' }, (error) => {
      if (error && !response.headersSent) response.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
    });
  }
}
