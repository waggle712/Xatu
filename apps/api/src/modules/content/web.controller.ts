import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { APP_ID, APP_SCHEME } from '@xatu/config/brand';
import { parseShareLink, productSharePath, shareUrl, shopSharePath } from '@xatu/shared';
import type { Response } from 'express';
import { AppError } from '../../common/errors.js';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { env } from '../../config/env.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { notFoundHtml, previewCsp, productPreviewHtml, shopPreviewHtml } from './web-preview.js';

/** Share links point here: PUBLIC_WEB_URL in production, the API itself in development. */
const webBase = () => env.PUBLIC_WEB_URL || env.PUBLIC_API_URL;

const origin = (url: string) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};
const CSP = previewCsp(
  [origin(env.MEDIA_PUBLIC_BASE_URL), origin(env.PUBLIC_API_URL)].filter((o): o is string => !!o),
);

/**
 * The web side of share links: the iOS / Android link files and a small preview page for each
 * product (/p/<id>) and shop (/s/<handle>). Built only from the public catalog and shop views,
 * so drafts, hidden listings, non-public shops and exact locations never show here.
 */
@ApiExcludeController()
@Controller()
@UseGuards(RateLimitGuard)
export class WebController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly profiles: ProfilesService,
  ) {}

  /** iOS universal links. Served as JSON at this exact path, no redirect, no extension. */
  @Get('.well-known/apple-app-site-association')
  appleAppSiteAssociation(@Res() res: Response): void {
    if (!env.APPLE_TEAM_ID) {
      res.status(404).json({ error: { code: 'not_configured', message: 'Not set up' } });
      return;
    }
    res
      .type('application/json')
      .set('Cache-Control', 'public, max-age=3600')
      .send(
        JSON.stringify({
          applinks: {
            details: [
              {
                appIDs: [`${env.APPLE_TEAM_ID}.${APP_ID}`],
                // Only product and shop pages open the app.
                components: [{ '/': '/p/*' }, { '/': '/s/*' }],
              },
            ],
          },
        }),
      );
  }

  /** Android App Links (Digital Asset Links). */
  @Get('.well-known/assetlinks.json')
  assetLinks(@Res() res: Response): void {
    if (env.ANDROID_CERT_SHA256.length === 0) {
      res.status(404).json({ error: { code: 'not_configured', message: 'Not set up' } });
      return;
    }
    res
      .type('application/json')
      .set('Cache-Control', 'public, max-age=3600')
      .send(
        JSON.stringify([
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: APP_ID,
              sha256_cert_fingerprints: env.ANDROID_CERT_SHA256,
            },
          },
        ]),
      );
  }

  @Get('p/:id')
  // Link-preview crawlers (WhatsApp, Telegram) fetch these, many behind shared carrier IPs.
  @RateLimit({ name: 'web:preview', limit: 600, windowSeconds: 60 })
  async product(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const target = parseShareLink(productSharePath(id));
    if (target?.type !== 'product') return this.notFound(res);
    const product = await this.catalog.getPublic(target.id).catch(notFoundOr);
    if (!product) return this.notFound(res);
    const path = productSharePath(product.id);
    this.send(
      res,
      200,
      productPreviewHtml(product, {
        webUrl: shareUrl(webBase(), path),
        appPath: `${APP_SCHEME}:/${path}`,
        appStoreUrl: env.APP_STORE_URL,
      }),
    );
  }

  @Get('s/:handle')
  @RateLimit({ name: 'web:preview', limit: 600, windowSeconds: 60 })
  async shop(@Param('handle') handle: string, @Res() res: Response): Promise<void> {
    const target = parseShareLink(shopSharePath(handle));
    if (target?.type !== 'shop') return this.notFound(res);
    const shop = await this.profiles.getPublicShop(target.handle).catch(notFoundOr);
    if (!shop) return this.notFound(res);
    const path = shopSharePath(shop.handle);
    this.send(
      res,
      200,
      shopPreviewHtml(shop, {
        webUrl: shareUrl(webBase(), path),
        appPath: `${APP_SCHEME}:/${path}`,
        appStoreUrl: env.APP_STORE_URL,
      }),
    );
  }

  private notFound(res: Response): void {
    this.send(res, 404, notFoundHtml());
  }

  private send(res: Response, status: number, html: string): void {
    res
      .status(status)
      .type('text/html; charset=utf-8')
      .set({
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
      })
      .send(html);
  }
}

/** A 404 from the public views means "show the not-available page"; anything else is a real error. */
function notFoundOr(err: unknown): null {
  if (err instanceof AppError && err.getStatus() === 404) return null;
  throw err;
}
