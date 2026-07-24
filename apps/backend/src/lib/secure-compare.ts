import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of two secrets. Returns false when either value is
 * missing. Comparing lengths first is safe: the length of a shared secret is
 * not itself sensitive, and timingSafeEqual requires equal-length buffers.
 */
export function secureCompare(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}
