import { describe, expect, it } from 'vitest';
import { normalizeBarcode } from './barcode';

describe('barcode identity', () => {
  it('validates the check digit before accepting product codes', () => {
    expect(normalizeBarcode('4006381333931')).toBe('04006381333931');
    expect(normalizeBarcode('96385074')).toBe('00000096385074');
    for (const code of ['4006381333932', '', '123', 'https://example.com'])
      expect(normalizeBarcode(code)).toBeNull();
  });
  it('keeps a UPC and its zero-prefixed EAN identical', () => {
    expect(normalizeBarcode('0 36000 29145 2')).toBe(normalizeBarcode('0036000291452'));
  });
});
