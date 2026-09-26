import { describe, it, expect } from 'vitest';
import { checkBundleSize } from '../src/bundle-size.js';

describe('checkBundleSize', () => {
  it('returns ok true with the summed totalBytes when under budget', () => {
    const result = checkBundleSize([{ path: 'a.js', bytes: 100 }, { path: 'b.js', bytes: 50 }], 1000);
    expect(result).toEqual({ ok: true, totalBytes: 150, maxBytes: 1000, errors: [] });
  });

  it('returns ok true at the exact boundary (total equals budget, not exceeding it) (Review Focus)', () => {
    const result = checkBundleSize([{ path: 'a.js', bytes: 1000 }], 1000);
    expect(result.ok).toBe(true);
  });

  it('returns ok false with a descriptive error when the total exceeds the budget', () => {
    const result = checkBundleSize([{ path: 'a.js', bytes: 1500 }], 1000);
    expect(result.ok).toBe(false);
    expect(result.totalBytes).toBe(1500);
    expect(result.errors[0]).toContain('1500');
    expect(result.errors[0]).toContain('1000');
    expect(result.errors[0]).toContain('500'); // the overage
  });

  it('returns ok true and totalBytes 0 for an empty file list', () => {
    expect(checkBundleSize([], 1000)).toEqual({ ok: true, totalBytes: 0, maxBytes: 1000, errors: [] });
  });

  it('sums many files correctly', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.js`, bytes: 100 }));
    expect(checkBundleSize(files, 5000).totalBytes).toBe(1000);
  });
});
