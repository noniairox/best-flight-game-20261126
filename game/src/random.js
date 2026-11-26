// Seeded randomness for Sky Courier: deterministic terrain and missions.
// A mulberry32 PRNG plus smooth value noise over a hashed integer grid.
// Pure functions — no Math.random, so the same seed always builds the same world.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// Two-octave value noise over a hashed integer grid. Each octave is a
// smooth interpolation of corner hashes; the sum is clamped to [-1, 1].
// The 140 m octave shapes the islands, the 47 m one roughens them.
export function makeNoise2D(seed) {
  const s = seed >>> 0;
  function grid(x, z, cell) {
    const gx = x / cell;
    const gz = z / cell;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = smooth(gx - x0);
    const fz = smooth(gz - z0);
    const a = hash2(x0, z0, s);
    const b = hash2(x0 + 1, z0, s);
    const c = hash2(x0, z0 + 1, s);
    const d = hash2(x0 + 1, z0 + 1, s);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  return function noise(x, z) {
    const v = grid(x, z, 140) * 0.65 + grid(x, z, 47) * 0.35;
    return Math.max(-1, Math.min(1, v));
  };
}
