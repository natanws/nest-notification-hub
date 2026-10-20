import { hashRequest, stableStringify } from './request-hash';

describe('stableStringify', () => {
  it('ignores key order at every nesting level', () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } };
    const b = { a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 };

    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('keeps array order significant', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe('hashRequest', () => {
  it('produces a 64-char hex sha256 digest', () => {
    expect(hashRequest({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when any value changes', () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});
