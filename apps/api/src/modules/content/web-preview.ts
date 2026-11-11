import { APP_ID, APP_NAME, APP_SCHEME } from '@xatu/config/brand';
import { formatPaise, type PublicProduct, type PublicShop } from '@xatu/shared';

/**
 * Small web pages for shared links: what WhatsApp and browsers show when the app isn't installed
 * (or before universal links / App Links are verified). No scripts at all; every value a seller
 * wrote is HTML-escaped, including inside attributes. No "money held" or Protected Pay wording.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export interface PreviewLinks {
  /** Canonical https link for og:url, e.g. https://example.in/p/<id>. */
  webUrl: string;
  /** The same page inside the app, e.g. xatu://p/<id>. */
  appPath: string;
  appStoreUrl: string;
}

const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_ID}`;

/** Content-Security-Policy: no scripts, no frames, no forms; images only from our media hosts. */
export function previewCsp(imageOrigins: string[]): string {
  const img = ['data:', ...imageOrigins].join(' ');
  return [
    "default-src 'none'",
    `img-src ${img}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

interface PageInput {
  title: string;
  description: string;
  imageUrl: string | null;
  ogType: 'product' | 'profile';
  links: PreviewLinks;
  body: string;
}

function page({ title, description, imageUrl, ogType, links, body }: PageInput): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const meta = [
    `<meta property="og:site_name" content="${escapeHtml(APP_NAME)}">`,
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${escapeHtml(links.webUrl)}">`,
    imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : '',
    `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="description" content="${d}">`,
    `<link rel="canonical" href="${escapeHtml(links.webUrl)}">`,
  ]
    .filter(Boolean)
    .join('\n    ');
  const appStore = links.appStoreUrl
    ? `<a class="secondary" href="${escapeHtml(links.appStoreUrl)}">App Store</a>`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>${t} · ${escapeHtml(APP_NAME)}</title>
    ${meta}
    <style>${STYLE}</style>
  </head>
  <body>
    <main>
      ${body}
      <div class="actions">
        <a class="primary" href="${escapeHtml(links.appPath)}">Open in ${escapeHtml(APP_NAME)} · <span lang="ta">${escapeHtml(APP_NAME)}-இல் திறக்கவும்</span></a>
        <a class="secondary" href="${PLAY_STORE_URL}">Google Play</a>
        ${appStore}
      </div>
    </main>
  </body>
</html>
`;
}

export function productPreviewHtml(product: PublicProduct, links: PreviewLinks): string {
  const price = Math.min(...product.variants.map((v) => v.pricePaise));
  const priceText = product.variants.length > 1 ? `from ${formatPaise(price)}` : formatPaise(price);
  const place = [product.maker.areaName, product.maker.city].filter(Boolean).join(', ');
  const story = product.description ?? product.descriptionTa ?? '';
  const photo = product.photos[0] ?? null;
  const description = clip(
    `${priceText} · ${product.maker.businessName}${place ? `, ${place}` : ''}${story ? ` · ${story}` : ''}`,
    200,
  );
  const body = `
      ${photo ? `<img class="photo" src="${escapeHtml(photo.urls.card)}" width="${photo.width}" height="${photo.height}" alt="${escapeHtml(product.title)}">` : ''}
      <h1>${escapeHtml(product.title)}</h1>
      ${product.titleTa ? `<p class="ta" lang="ta">${escapeHtml(product.titleTa)}</p>` : ''}
      <p class="price">${escapeHtml(priceText)}</p>
      <p class="maker">${escapeHtml(product.maker.businessName)}${place ? ` · ${escapeHtml(place)}` : ''}</p>
      ${story ? `<p class="story">${escapeHtml(clip(story, 400))}</p>` : ''}`;
  return page({
    title: product.title,
    description,
    imageUrl: photo?.urls.card ?? null,
    ogType: 'product',
    links,
    body,
  });
}

export function shopPreviewHtml(shop: PublicShop, links: PreviewLinks): string {
  const place = [shop.areaName, shop.city].filter(Boolean).join(', ');
  const story = shop.storyEn ?? shop.storyTa ?? '';
  const description = clip(
    `${place}${shop.category ? ` · ${shop.category.nameEn}` : ''}${story ? ` · ${story}` : ''}`,
    200,
  );
  const body = `
      ${shop.cover ? `<img class="photo wide" src="${escapeHtml(shop.cover.urls.card)}" width="${shop.cover.width}" height="${shop.cover.height}" alt="${escapeHtml(shop.businessName)}">` : ''}
      <h1>${escapeHtml(shop.businessName)}</h1>
      <p class="maker">${escapeHtml(place)}${shop.category ? ` · ${escapeHtml(shop.category.nameEn)}` : ''}</p>
      ${story ? `<p class="story">${escapeHtml(clip(story, 400))}</p>` : ''}
      <p class="maker">${shop.liveProductCount} products</p>`;
  return page({
    title: shop.businessName,
    description,
    imageUrl: shop.cover?.urls.card ?? null,
    ogType: 'profile',
    links,
    body,
  });
}

export function notFoundHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="robots" content="noindex">
    <title>Not available · ${escapeHtml(APP_NAME)}</title>
    <style>${STYLE}</style>
  </head>
  <body>
    <main>
      <h1>This isn't available any more</h1>
      <p class="story" lang="ta">இது இப்போது கிடைக்கவில்லை</p>
      <div class="actions">
        <a class="primary" href="${APP_SCHEME}://">Open ${escapeHtml(APP_NAME)}</a>
        <a class="secondary" href="${PLAY_STORE_URL}">Google Play</a>
      </div>
    </main>
  </body>
</html>
`;
}

// Brand tokens (light and dark). Tap targets are at least 48px; text scales with the browser.
const STYLE = `
:root{--surface:#FCF8F1;--raised:#FFFFFF;--ink:#3A2230;--muted:#6E5A64;--line:#E8DCD3;--action:#E3A62F;--on-action:#3A2230}
@media (prefers-color-scheme:dark){:root{--surface:#1E1218;--raised:#2B1B24;--ink:#FCF8F1;--muted:#CDBBC3;--line:#3F2C36}}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--ink);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Tamil",sans-serif}
main{max-width:34rem;margin:0 auto;padding:1rem 1rem 2rem}
.photo{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover;border-radius:16px;background:var(--line)}
.photo.wide{aspect-ratio:16/9}
h1{font-family:Georgia,"Noto Serif Tamil",serif;font-size:1.6rem;line-height:1.25;margin:1rem 0 .25rem;overflow-wrap:anywhere}
.ta{margin:0;color:var(--muted)}
.price{font-size:1.4rem;font-weight:600;margin:.5rem 0}
.maker{color:var(--muted);margin:.25rem 0}
.story{margin:.75rem 0;overflow-wrap:anywhere}
.actions{display:flex;flex-direction:column;gap:.75rem;margin-top:1.5rem}
.actions a{display:flex;align-items:center;justify-content:center;min-height:48px;padding:.75rem 1rem;border-radius:999px;text-decoration:none;font-weight:600;text-align:center}
.primary{background:var(--action);color:var(--on-action)}
.secondary{border:1px solid var(--line);background:var(--raised);color:var(--ink)}
`;
