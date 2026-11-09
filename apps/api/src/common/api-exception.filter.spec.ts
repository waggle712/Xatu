import { NotFoundException } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { AppError } from './errors.js';

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  it('keeps AppError code, message and details', () => {
    const { status, body } = filter.toBody(
      new AppError('out_of_stock', 'Sold out.', 409, { left: 0 }),
    );
    expect(status).toBe(409);
    expect(body).toEqual({
      error: { code: 'out_of_stock', message: 'Sold out.', details: { left: 0 } },
    });
  });

  it('maps Nest HTTP exceptions to a code by status', () => {
    const { status, body } = filter.toBody(new NotFoundException('No such product'));
    expect(status).toBe(404);
    expect(body.error).toEqual({ code: 'not_found', message: 'No such product' });
  });

  it('hides internals of unknown errors', () => {
    const { status, body } = filter.toBody(new Error('connection string leaked'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('leaked');
  });
});
