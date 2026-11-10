import sharp from 'sharp';
import { processImage } from './image-processor.js';

/** A real JPEG with GPS coordinates and a camera model in its EXIF. */
async function jpegWithGps(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c98a96' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'Phone 1', Orientation: '1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '10/1 49/1 42/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '78/1 40/1 46/1',
      },
    })
    .toBuffer();
}

describe('processImage', () => {
  it('strips all EXIF, including GPS, and returns a blurhash', async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const res = await processImage(input, 'image/jpeg');
    if (!res.ok) throw new Error(res.reason);
    const meta = await sharp(res.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(res.body.includes(Buffer.from('TestCam'))).toBe(false);
    expect(res).toMatchObject({ contentType: 'image/jpeg', width: 800, height: 600 });
    expect(res.blurhash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,}$/);
  });

  it('rejects a file whose bytes are not an image', async () => {
    expect(await processImage(Buffer.from('%PDF-1.7 not an image'), 'image/jpeg')).toEqual({
      ok: false,
      reason: 'not_an_image',
    });
  });

  it('rejects a PNG uploaded as JPEG', async () => {
    const png = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    expect(await processImage(png, 'image/jpeg')).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('rejects tiny images', async () => {
    expect(await processImage(await jpegWithGps(120, 120), 'image/jpeg')).toEqual({
      ok: false,
      reason: 'too_small',
    });
  });

  it('rejects truncated files', async () => {
    const broken = (await jpegWithGps()).subarray(0, 300);
    expect(await processImage(broken, 'image/jpeg')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('keeps transparency for PNGs with alpha', async () => {
    const png = await sharp({
      create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const res = await processImage(png, 'image/png');
    expect(res.ok && res.contentType).toBe('image/png');
  });
});
