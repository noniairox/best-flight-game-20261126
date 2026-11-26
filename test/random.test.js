import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeNoise2D } from '../game/src/random.js';

describe('mulberry32 seeded RNG', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    for (let i = 0; i < 20; i++) assert.equal(a(), b());
  });

  it('differs across seeds', () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    assert.notEqual(a, b);
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });
});

describe('makeNoise2D value noise', () => {
  it('is deterministic for the same seed and point', () => {
    const n1 = makeNoise2D(42);
    const n2 = makeNoise2D(42);
    assert.equal(n1(12.3, -45.6), n2(12.3, -45.6));
  });

  it('stays in [-1, 1]', () => {
    const noise = makeNoise2D(7);
    for (let x = -500; x <= 500; x += 37) {
      for (let z = -500; z <= 500; z += 53) {
        const v = noise(x, z);
        assert.ok(v >= -1 && v <= 1, `out of range: ${v}`);
      }
    }
  });

  it('is smooth: nearby points are close', () => {
    const noise = makeNoise2D(7);
    const a = noise(100, 100);
    const b = noise(101, 100);
    assert.ok(Math.abs(a - b) < 0.2, `jump too big: ${a} vs ${b}`);
  });

  it('varies over distance: spread across far points is wide', () => {
    const noise = makeNoise2D(7);
    let min = 1;
    let max = -1;
    for (let i = 0; i < 20; i++) {
      const v = noise(i * 173 - 800, i * 211 - 900);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    assert.ok(max - min > 0.5, `noise looks flat: range ${min}..${max}`);
  });

  it('reaches both signs over the map, so patches are not one-sided', () => {
    const noise = makeNoise2D(2026);
    let min = 1;
    let max = -1;
    for (let x = -1200; x <= 1200; x += 60) {
      for (let z = -1200; z <= 1200; z += 60) {
        const v = noise(x, z);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    assert.ok(min < -0.3, `noise never goes low: min ${min}`);
    assert.ok(max > 0.3, `noise never goes high: max ${max}`);
  });
});
