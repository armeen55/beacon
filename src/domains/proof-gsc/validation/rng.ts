/**
 * Deterministic seeded RNG for the validation harness. Every random draw in
 * the harness derives from the run id string plus a purpose salt; Date.now
 * and Math.random are banned (protocol: reproducible runs, seeded nulls).
 */

/** FNV-1a string hash to unsigned 32-bit int. Mirrors aa-calibration.ts. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG seeded from a 32-bit int. Deterministic, fast, adequate
 *  for bootstrap resampling (not cryptographic, does not need to be). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A PRNG seeded from any string (runId + salt). */
export function rngFromString(seedString: string): () => number {
  return mulberry32(fnv1a(seedString));
}

/** Deterministic ordering key for a string under a salt: hash-sort helper so
 *  selections are stable but never traffic-ordered (the old top-40 mistake). */
export function hashKey(value: string, salt: string): number {
  return fnv1a(`${salt}::${value}`);
}
