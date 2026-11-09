import { z } from 'zod';
import { AppError } from './errors.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ phone: z.string().min(10), qty: z.number().int() }),
  );

  it('returns parsed data when valid', () => {
    expect(pipe.transform({ phone: '9876543210', qty: 2 })).toEqual({
      phone: '9876543210',
      qty: 2,
    });
  });

  it('throws validation_failed with field paths when invalid', () => {
    try {
      pipe.transform({ phone: '123', qty: 1.5 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe('validation_failed');
      expect(e.getStatus()).toBe(400);
      expect((e.details as { path: string }[]).map((d) => d.path)).toEqual(['phone', 'qty']);
    }
  });
});
