import { describe, expect, it } from 'vitest';
import { formatPrice, parsePrice, priceInput, safeReturn } from '../../src/lib/domain';

describe('exact integer money boundaries', () => {
  it.each([
    ['0', 0], ['0,01', 1], ['1.2', 120], ['1250,50', 125050],
    [' 00012,09 ', 1209], ['90071992547409.90', Number.MAX_SAFE_INTEGER - 1],
    ['90071992547409,91', Number.MAX_SAFE_INTEGER],
  ])('parses %s without rounding', (input, expected) => expect(parsePrice(input)).toBe(expected));
  it.each(['', ' ', '-1', '+1', 'NaN', 'Infinity', '1e3', '.5', '1.', '1,001', '1,2,3', '1 000', '90071992547409.92', '9'.repeat(33)])('rejects invalid price %j', input => {
    expect(() => parsePrice(input)).toThrow();
  });
  it('round trips the maximum safe integer including the last kopeck', () => {
    expect(priceInput(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    expect(parsePrice(priceInput(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(formatPrice(Number.MAX_SAFE_INTEGER).replaceAll('\u00a0', ' ')).toBe('90 071 992 547 409,91 ₽');
    expect(formatPrice(1)).toBe('0,01\u00a0₽');
  });
});

describe('return destination security', () => {
  it.each(['/wishlists/item?edit=1#gift', '/s/abc', '/'])('retains app path %s', path => expect(safeReturn(path)).toBe(path));
  it.each([null, '', '//evil.test', 'https://evil.test', 'javascript:alert(1)', '/\\evil.test', '/\tevil.test', '/path\n', '/login', '/login?returnTo=/x', '/register#x'])('rejects unsafe or looping destination %j', path => {
    expect(safeReturn(path)).toBe('/wishlists');
  });
});
