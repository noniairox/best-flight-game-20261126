import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookAt, projectPoint, projectClipped, makeChaseCamera } from '../game/src/render.js';
import { createPlane } from '../game/src/physics.js';

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

describe('lookAt camera basis', () => {
  it('builds an orthonormal right-handed basis', () => {
    const cam = lookAt({ x: 0, y: 10, z: 20 }, { x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const len = (a) => Math.sqrt(dot(a, a));
    assert.ok(approx(len(cam.forward), 1));
    assert.ok(approx(len(cam.right), 1));
    assert.ok(approx(len(cam.up), 1));
    assert.ok(approx(dot(cam.forward, cam.right), 0));
    assert.ok(approx(dot(cam.forward, cam.up), 0));
    assert.ok(approx(dot(cam.right, cam.up), 0));
    // looking north (-z): forward should be (0,0,-1)
    assert.ok(approx(cam.forward.z, -1));
  });
});

describe('projectPoint', () => {
  const cam = lookAt({ x: 0, y: 10, z: 20 }, { x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 });
  cam.fov = Math.PI / 3.5; // ~51 deg half? no: full vertical fov ~ 72 deg

  it('projects a point straight ahead near screen center', () => {
    const p = projectPoint(cam, { x: 0, y: 10, z: -100 });
    assert.equal(p.behind, false);
    assert.ok(Math.abs(p.x) < 0.01, `x should be ~0, got ${p.x}`);
    assert.ok(Math.abs(p.y) < 0.01, `y should be ~0, got ${p.y}`);
    assert.ok(p.depth > 0);
  });

  it('marks points behind the camera', () => {
    const p = projectPoint(cam, { x: 0, y: 10, z: 50 });
    assert.equal(p.behind, true);
  });

  it('puts a high point above center and a right point to the right', () => {
    const high = projectPoint(cam, { x: 0, y: 60, z: -100 });
    assert.ok(high.y > 0, `high point should be above center (positive y), got ${high.y}`);
    const right = projectPoint(cam, { x: 40, y: 10, z: -100 });
    assert.ok(right.x > 0, `right point should be positive x, got ${right.x}`);
  });

  it('scales nearer points larger', () => {
    const near = projectPoint(cam, { x: 20, y: 10, z: -30 });
    const far = projectPoint(cam, { x: 20, y: 10, z: -200 });
    assert.ok(Math.abs(near.x) > Math.abs(far.x), 'near point should be further from center');
  });
});

describe('projectClipped', () => {
  it('clips a quad straddling the camera instead of dropping it', () => {
    const cam = lookAt({ x: 0, y: 10, z: 20 }, { x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 });
    cam.fov = Math.PI / 3.5;
    // A quad crossing the near plane: two corners ahead, two behind.
    const pts = projectClipped(cam, [
      { x: -5, y: 10, z: -10 },
      { x: 5, y: 10, z: -10 },
      { x: 5, y: 10, z: 40 },
      { x: -5, y: 10, z: 40 },
    ]);
    assert.ok(pts, 'straddling quad should clip, not vanish');
    assert.ok(pts.length >= 3, `clipped polygon needs 3+ points, got ${pts.length}`);
    assert.ok(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  });

  it('returns null for a quad fully behind the camera', () => {
    const cam = lookAt({ x: 0, y: 10, z: 20 }, { x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 });
    const pts = projectClipped(cam, [
      { x: -5, y: 10, z: 30 },
      { x: 5, y: 10, z: 30 },
      { x: 5, y: 10, z: 40 },
      { x: -5, y: 10, z: 40 },
    ]);
    assert.equal(pts, null);
  });
});

describe('makeChaseCamera', () => {
  it('sits behind and above the plane, looking forward', () => {
    const plane = createPlane({ x: 0, y: 100, z: 0, headingDeg: 0 });
    plane.pitch = 0;
    plane.roll = 0;
    const cam = makeChaseCamera(plane, 1 / 60);
    // plane heading 0 = north (-z): camera should be south of the plane (+z)
    assert.ok(cam.pos.z > plane.pos.z, `camera should trail behind, z ${cam.pos.z}`);
    assert.ok(cam.pos.y > plane.pos.y, 'camera should sit above the plane');
    assert.ok(cam.forward.z < 0, 'camera should look north');
  });
});
