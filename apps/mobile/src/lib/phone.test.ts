import { formatIndianPhone, isOtpCode, toIndianE164 } from './phone';

describe('toIndianE164', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
  ])('accepts %s', (input, expected) => {
    expect(toIndianE164(input)).toBe(expected);
  });

  it.each(['12345', '5876543210', '98765432101', '', 'abcdefghij'])('rejects %s', (input) => {
    expect(toIndianE164(input)).toBeNull();
  });
});

it('formats numbers in 5+5 groups', () => {
  expect(formatIndianPhone('+919876543210')).toBe('+91 98765 43210');
});

it('checks 6-digit codes', () => {
  expect(isOtpCode('123456')).toBe(true);
  expect(isOtpCode('12345')).toBe(false);
  expect(isOtpCode('12345a')).toBe(false);
});
