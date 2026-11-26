import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../game/src/terrain.js';

describe('createTerrain', () => {
  it('is deterministic for the same seed', () => {
    const t1 = createTerrain(1337);
    const t2 = createTerrain(1337);
    assert.equal(t1.heightAt(123, -456), t2.heightAt(123, -456));
    assert.equal(t1.heightAt(-800, 200), t2.heightAt(-800, 200));
  });

  it('has sea at open water far from islands', () => {
    const t = createTerrain(1337);
    assert.ok(t.heightAt(0, 1150) <= 0.5, `expected sea, got ${t.heightAt(0, 1150)}`);
    assert.ok(t.isWater(0, 1150));
    assert.ok(t.isWater(-1150, -1150));
  });

  it('has real hills on the main island', () => {
    const t = createTerrain(1337);
    const h = t.heightAt(150, -150);
    assert.ok(h > 20, `main island should be hilly, got ${h}`);
    assert.ok(h < 140, `hills too tall: ${h}`);
  });

  it('flattens the home runway: constant height across the strip', () => {
    const t = createTerrain(1337);
    const home = t.runways.find((r) => r.id === 'home');
    assert.ok(home, 'home runway missing');
    const h0 = t.heightAt(home.center.x, home.center.z);
    assert.ok(h0 > 1 && h0 < 20, `runway elevation odd: ${h0}`);
    // sample corners and middle of the strip: all equal to runway elevation
    const half = home.length / 2;
    const pts = [
      [home.center.x, home.center.z - half],
      [home.center.x, home.center.z + half],
      [home.center.x - home.width / 2, home.center.z],
      [home.center.x + home.width / 2, home.center.z],
    ];
    for (const [x, z] of pts) {
      assert.ok(Math.abs(t.heightAt(x, z) - home.elevation) < 0.01,
        `runway not flat at ${x},${z}: ${t.heightAt(x, z)} vs ${home.elevation}`);
    }
  });

  it('exposes at least three runways including the home strip', () => {
    const t = createTerrain(1337);
    assert.ok(t.runways.length >= 3, `expected >=3 runways, got ${t.runways.length}`);
    assert.ok(t.runways.every((r) => r.length > 100 && r.width >= 14));
  });

  it('keeps terrain heights within sane bounds', () => {
    const t = createTerrain(1337);
    for (let x = -1100; x <= 1100; x += 100) {
      for (let z = -1100; z <= 1100; z += 100) {
        const h = t.heightAt(x, z);
        assert.ok(h >= -1 && h <= 160, `height out of bounds at ${x},${z}: ${h}`);
      }
    }
  });

  it('runwayAt finds the home strip at its centre, on the centreline', async () => {
    const { runwayAt } = await import('../game/src/physics.js');
    const t = createTerrain(1337);
    const home = t.runways.find((r) => r.id === 'home');
    const spot = runwayAt(t, home.center.x, home.center.z);
    assert.ok(spot, 'runwayAt missed the home strip centre');
    assert.equal(spot.runway.id, 'home');
    assert.ok(Math.abs(spot.across) < 0.5, `centreline offset odd: ${spot.across}`);
    assert.equal(runwayAt(t, 1500, 1500), null, 'open sea should not be a runway');
  });
});
