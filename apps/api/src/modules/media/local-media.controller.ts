import { Controller, Get, HttpCode, HttpStatus, Param, Put, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { AppError } from '../../common/errors.js';
import { localPath, LocalStorage, verifyUploadToken } from './local-storage.js';

/**
 * Development and tests only (MEDIA_STORAGE=local): stands in for R2 signed uploads and the CDN.
 * Enforces the same rules as the signed R2 URL: expiry, exact content type and exact size.
 */
@ApiExcludeController()
@Controller('media/local')
export class LocalMediaController {
  private readonly storage = new LocalStorage();

  @Put('upload/:token')
  @HttpCode(200)
  async upload(@Param('token') token: string, @Req() req: Request): Promise<{ ok: true }> {
    const claims = verifyUploadToken(token);
    if (!claims)
      throw new AppError(
        'upload_url_invalid',
        'Upload link expired or invalid.',
        HttpStatus.FORBIDDEN,
      );
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body))
      throw new AppError('upload_empty', 'No file received.', HttpStatus.BAD_REQUEST);
    if (req.headers['content-type'] !== claims.contentType || body.length !== claims.byteSize) {
      throw new AppError(
        'upload_mismatch',
        'File does not match the upload request.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.storage.write(claims.key, body);
    return { ok: true };
  }

  @Get('file/*path')
  async file(@Param('path') path: string | string[], @Res() res: Response): Promise<void> {
    const key = Array.isArray(path) ? path.join('/') : path;
    try {
      const data = await readFile(localPath(key));
      res.setHeader('Content-Type', key.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(data);
    } catch {
      res.status(404).json({ error: { code: 'not_found', message: 'File not found.' } });
    }
  }
}
