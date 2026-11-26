// Software 3D renderer for Sky Courier: a chase/cockpit camera over a
// heightmap archipelago, drawn on a 2D canvas with a painter's algorithm.
// No WebGL, no assets — sky, sea, terrain, runways, rings, clouds and the
// plane are all drawn from code, so the game runs from plain static files.

import { COLORS, VIEW } from './config.js';
import { terrainColor } from './terrain.js';
import { makeNoise2D } from './random.js';

// Smooth patch noise, so the hills read as fields and forest instead of a
// checkerboard: adjacent quads vary gradually, not independently.
const patchNoise = makeNoise2D(2026);

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function norm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// Camera basis: forward, right and up are unit vectors, right-handed.
export function lookAt(eye, target, upWorld = { x: 0, y: 1, z: 0 }) {
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, upWorld));
  const up = cross(right, forward);
  return { pos: eye, forward, right, up, fov: VIEW.fov };
}

// Camera-space coords of a world point: x right, y up, z forward.
export function cameraSpace(cam, p) {
  const rel = sub(p, cam.pos);
  return { x: dot(rel, cam.right), y: dot(rel, cam.up), z: dot(rel, cam.forward) };
}

// Clip a polygon against the near plane (z >= near) in camera space, then
// project it. Returns screen points in NDC, or null when fully behind.
// Without this, any quad straddling the camera — the runway under the
// plane, the ground right ahead — vanishes whole instead of drawing the
// part that is in front.
export function projectClipped(cam, points, near = 0.5) {
  const cs = points.map((p) => cameraSpace(cam, p));
  const clipped = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    const aIn = a.z >= near;
    const bIn = b.z >= near;
    if (aIn) clipped.push(a);
    if (aIn !== bIn) {
      const t = (near - a.z) / (b.z - a.z);
      clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
    }
  }
  if (clipped.length < 3) return null;
  const f = 1 / Math.tan(cam.fov / 2);
  return clipped.map((q) => ({ x: (q.x * f) / q.z, y: (q.y * f) / q.z, depth: q.z }));
}

// Project a world point to normalized screen space: x/y in [-1, 1] at the
// frame edges, depth in metres along the view axis. Points behind the
// camera are flagged instead of mirrored.
export function projectPoint(cam, p) {
  const rel = sub(p, cam.pos);
  const zc = dot(rel, cam.forward);
  if (zc <= 0.5) return { x: 0, y: 0, depth: zc, behind: true };
  const f = 1 / Math.tan(cam.fov / 2);
  return {
    x: (dot(rel, cam.right) * f) / zc,
    y: (dot(rel, cam.up) * f) / zc,
    depth: zc,
    behind: false,
  };
}

export function planeForward(plane) {
  const cp = Math.cos(plane.pitch);
  return {
    x: Math.sin(plane.heading) * cp,
    y: Math.sin(plane.pitch),
    z: -Math.cos(plane.heading) * cp,
  };
}

// Chase camera: behind and above the plane, looking ahead of it.
export function makeChaseCamera(plane) {
  const f = planeForward(plane);
  const pos = {
    x: plane.pos.x - f.x * VIEW.chaseDistance,
    y: plane.pos.y + VIEW.chaseHeight,
    z: plane.pos.z - f.z * VIEW.chaseDistance,
  };
  const target = {
    x: plane.pos.x + f.x * VIEW.lookAhead,
    y: plane.pos.y + f.y * VIEW.lookAhead,
    z: plane.pos.z + f.z * VIEW.lookAhead,
  };
  return lookAt(pos, target);
}

// Cockpit camera: from the pilot's seat, looking along the nose.
export function makeCockpitCamera(plane) {
  const f = planeForward(plane);
  const pos = {
    x: plane.pos.x + f.x * 1.4,
    y: plane.pos.y + 0.9,
    z: plane.pos.z + f.z * 1.4,
  };
  const target = {
    x: plane.pos.x + f.x * 60,
    y: plane.pos.y + f.y * 60,
    z: plane.pos.z + f.z * 60,
  };
  return lookAt(pos, target);
}

// Plane orientation basis: forward, right and up, with roll applied.
export function planeBasis(plane) {
  const f = planeForward(plane);
  const r0 = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const u0 = cross(r0, f);
  const cr = Math.cos(plane.roll);
  const sr = Math.sin(plane.roll);
  const r = {
    x: r0.x * cr + u0.x * sr,
    y: r0.y * cr + u0.y * sr,
    z: r0.z * cr + u0.z * sr,
  };
  const u = {
    x: u0.x * cr - r0.x * sr,
    y: u0.y * cr - r0.y * sr,
    z: u0.z * cr - r0.z * sr,
  };
  return { f, r, u };
}

function localToWorld(plane, basis, lx, ly, lz) {
  return {
    x: plane.pos.x + basis.r.x * lx + basis.u.x * ly - basis.f.x * lz,
    y: plane.pos.y + basis.r.y * lx + basis.u.y * ly - basis.f.y * lz,
    z: plane.pos.z + basis.r.z * lx + basis.u.z * ly - basis.f.z * lz,
  };
}

// ---------------------------------------------------------------------------
// Scene drawing. The draw list is sorted far-to-near each frame so hills,
// sea, runways, rings and clouds occlude each other correctly.
// ---------------------------------------------------------------------------

const SUN_DIR = norm({ x: -0.55, y: 0.32, z: 0.75 });

function shade(base, normal) {
  const lambert = 0.62 + 0.38 * Math.max(0, dot(normal, SUN_DIR));
  const n = parseInt(base.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * lambert));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * lambert));
  const b = Math.min(255, Math.round((n & 255) * lambert));
  return `rgb(${r},${g},${b})`;
}

export function createClouds(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const clouds = [];
  for (let i = 0; i < 22; i++) {
    const ang = next() * Math.PI * 2;
    const dist = 500 + next() * 900;
    clouds.push({
      x: Math.sin(ang) * dist,
      y: 260 + next() * 130,
      z: Math.cos(ang) * dist,
      s: 60 + next() * 90,
    });
  }
  return clouds;
}

export function drawScene(ctx, w, h, state) {
  const { cam, plane, terrain, run, time, clouds, cameraMode } = state;
  const toX = (nx) => (nx + 1) * 0.5 * w;
  const toY = (ny) => (1 - (ny + 1) * 0.5) * h;
  const scale = h / 2;

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, COLORS.skyTop);
  sky.addColorStop(0.55, COLORS.skyMid);
  sky.addColorStop(1, COLORS.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sun.
  const sunPos = {
    x: cam.pos.x + SUN_DIR.x * 3000,
    y: cam.pos.y + SUN_DIR.y * 3000,
    z: cam.pos.z + SUN_DIR.z * 3000,
  };
  const sun = projectPoint(cam, sunPos);
  if (!sun.behind) {
    const sx = toX(sun.x);
    const sy = toY(sun.y);
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 120);
    glow.addColorStop(0, 'rgba(255,243,196,0.95)');
    glow.addColorStop(0.25, 'rgba(255,220,140,0.55)');
    glow.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 130, sy - 130, 260, 260);
  }

  // Far sea fill below the horizon, so the frame edges never show sky.
  const horizonFar = {
    x: cam.pos.x + cam.forward.x * 2000,
    y: cam.pos.y,
    z: cam.pos.z + cam.forward.z * 2000,
  };
  const horizon = projectPoint(cam, horizonFar);
  const horizonY = horizon.behind ? h * 0.5 : toY(horizon.y);
  const sea = ctx.createLinearGradient(0, horizonY, 0, h);
  sea.addColorStop(0, COLORS.sea);
  sea.addColorStop(1, COLORS.seaDeep);
  ctx.fillStyle = sea;
  ctx.fillRect(0, Math.max(0, horizonY), w, h - Math.max(0, horizonY));

  const items = [];

  // Terrain grid around the camera, far rows drawn first. 60 m cells over
  // a 2.4 km span cover the whole archipelago from anywhere in it.
  const cell = 60;
  const half = 20;
  const cx = Math.round(cam.pos.x / cell);
  const cz = Math.round(cam.pos.z / cell);
  const grid = [];
  for (let iz = -half; iz <= half; iz++) {
    grid.push([]);
    for (let ix = -half; ix <= half; ix++) {
      const x = (cx + ix) * cell;
      const z = (cz + iz) * cell;
      grid[iz + half].push({ x, z, y: terrain.heightAt(x, z) });
    }
  }
  for (let iz = 0; iz < half * 2; iz++) {
    for (let ix = 0; ix < half * 2; ix++) {
      const a = grid[iz][ix];
      const b = grid[iz][ix + 1];
      const c = grid[iz + 1][ix + 1];
      const d = grid[iz + 1][ix];
      const cy = (a.y + b.y + c.y + d.y) / 4;
      const cc = { x: (a.x + c.x) / 2, y: cy, z: (a.z + c.z) / 2 };
      const depth = dot(sub(cc, cam.pos), cam.forward);
      if (depth < 1) continue;
      const water = a.y <= 0.5 && b.y <= 0.5 && c.y <= 0.5 && d.y <= 0.5;
      let fill;
      if (water) {
        // Sea shimmer: brightness drifts slowly with time and place.
        const shimmer = 0.92 + 0.08 * Math.sin(time * 0.7 + (a.x + a.z) * 0.02);
        const base = parseInt(COLORS.sea.slice(1), 16);
        const r = Math.min(255, Math.round((((base >> 16) & 255) * shimmer)));
        const g = Math.min(255, Math.round((((base >> 8) & 255) * shimmer)));
        const b = Math.min(255, Math.round(((base & 255) * shimmer)));
        fill = `rgb(${r},${g},${b})`;
      } else {
        // Slope shading from the height gradient, plus a smooth patch
        // variation per quad so the hills read as fields and forest.
        const gx = (b.y - a.y) / cell;
        const gz = (d.y - a.y) / cell;
        const normal = norm({ x: -gx, y: 1, z: -gz });
        const patch = 0.93 + 0.14 * patchNoise(a.x, a.z);
        const base = shade(terrainColor(cy), normal);
        const m = base.match(/rgb\((\d+),(\d+),(\d+)\)/);
        fill = m
          ? `rgb(${Math.round(+m[1] * patch)},${Math.round(+m[2] * patch)},${Math.round(+m[3] * patch)})`
          : base;
      }
      items.push({
        depth,
        draw() {
          const pts = projectClipped(cam, [a, b, c, d]);
          if (!pts) return;
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.moveTo(toX(pts[0].x), toY(pts[0].y));
          for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(pts[i].x), toY(pts[i].y));
          ctx.closePath();
          ctx.fill();
        },
      });
    }
  }

  // Runways: asphalt quads with markings. They are drawn AFTER the terrain
  // as a decal pass, not in the depth-sorted list: a flat quad 0.4 m above
  // the pad loses the depth sort against the pad quads under it, so from
  // the cockpit it vanished under the grass. Painting it over the terrain
  // is correct — it sits on the flattened pad, nothing occludes it.
  const runwayDraws = [];
  for (const r of terrain.runways) {
    // No centre-depth cull: the camera often sits over the runway (on
    // final approach the centre is behind it while the far half is ahead),
    // so projectClipped decides visibility instead.
    const center = { x: r.center.x, y: r.elevation + 0.4, z: r.center.z };
    runwayDraws.push(() => {
        const h = (r.headingDeg * Math.PI) / 180;
        const fx = Math.sin(h);
        const fz = -Math.cos(h);
        const rx = Math.cos(h);
        const rz = Math.sin(h);
        const hl = r.length / 2;
        const hw = r.width / 2;
        const corners = [
          { x: center.x - fx * hl - rx * hw, y: center.y, z: center.z - fz * hl - rz * hw },
          { x: center.x + fx * hl - rx * hw, y: center.y, z: center.z + fz * hl - rz * hw },
          { x: center.x + fx * hl + rx * hw, y: center.y, z: center.z + fz * hl + rz * hw },
          { x: center.x - fx * hl + rx * hw, y: center.y, z: center.z - fz * hl + rz * hw },
        ];
        const poly = projectClipped(cam, corners);
        if (!poly) return;
        ctx.fillStyle = '#3a3f46';
        ctx.beginPath();
        ctx.moveTo(toX(poly[0].x), toY(poly[0].y));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(toX(poly[i].x), toY(poly[i].y));
        ctx.closePath();
        ctx.fill();
        // Centreline dashes, as thin clipped quads so the near ones survive.
        for (let d = -hl + 12; d < hl - 6; d += 24) {
          const dash = [
            { x: center.x + fx * d - rx * 0.5, y: center.y + 0.1, z: center.z + fz * d - rz * 0.5 },
            { x: center.x + fx * (d + 10) - rx * 0.5, y: center.y + 0.1, z: center.z + fz * (d + 10) - rz * 0.5 },
            { x: center.x + fx * (d + 10) + rx * 0.5, y: center.y + 0.1, z: center.z + fz * (d + 10) + rz * 0.5 },
            { x: center.x + fx * d + rx * 0.5, y: center.y + 0.1, z: center.z + fz * d + rz * 0.5 },
          ];
          const dp = projectClipped(cam, dash);
          if (!dp) continue;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.moveTo(toX(dp[0].x), toY(dp[0].y));
          for (let i = 1; i < dp.length; i++) ctx.lineTo(toX(dp[i].x), toY(dp[i].y));
          ctx.closePath();
          ctx.fill();
        }
        // Threshold bars at both ends.
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(1, scale * 0.004);
        for (const end of [-hl + 6, hl - 6]) {
          const p1 = projectPoint(cam, { x: center.x + fx * end - rx * (hw - 2), y: center.y + 0.1, z: center.z + fz * end - rz * (hw - 2) });
          const p2 = projectPoint(cam, { x: center.x + fx * end + rx * (hw - 2), y: center.y + 0.1, z: center.z + fz * end + rz * (hw - 2) });
          if (p1.behind || p2.behind) continue;
          ctx.beginPath();
          ctx.moveTo(toX(p1.x), toY(p1.y));
          ctx.lineTo(toX(p2.x), toY(p2.y));
          ctx.stroke();
        }
    });
  }

  // Rings: the next one gold, flown ones green, the rest pale blue.
  if (run) {
    const rings = run.mission.objectives.filter((o) => o.type === 'ring').map((o) => o.ring);
    rings.forEach((ring, i) => {
      const depth = dot(sub(ring, cam.pos), cam.forward);
      if (depth < 1) return;
      const state = i < run.ringsHit ? 'done' : i === run.ringsHit ? 'next' : 'future';
      items.push({
        depth,
        draw() {
          const c = projectPoint(cam, ring);
          if (c.behind) return;
          const f = 1 / Math.tan(cam.fov / 2);
          const radiusPx = (ring.r * f * scale) / c.depth;
          if (radiusPx < 2) return;
          const cx = toX(c.x);
          const cy = toY(c.y);
          const color = state === 'next' ? COLORS.ringNext : state === 'done' ? COLORS.ringDone : COLORS.ringFuture;
          ctx.save();
          ctx.globalAlpha = state === 'done' ? 0.45 : 0.95;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(2, radiusPx * 0.1);
          if (state === 'next') {
            ctx.shadowColor = color;
            ctx.shadowBlur = 18;
          }
          ctx.beginPath();
          ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          if (state === 'next' && radiusPx > 14) {
            ctx.fillStyle = '#20180a';
            ctx.font = `bold ${Math.round(radiusPx * 0.5)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(String(i + 1), cx, cy);
          }
        },
      });
    });
  }

  // Clouds as soft billboards.
  for (const cloud of clouds) {
    const depth = dot(sub(cloud, cam.pos), cam.forward);
    if (depth < 1) continue;
    items.push({
      depth,
      draw() {
        const c = projectPoint(cam, cloud);
        if (c.behind) return;
        const f = 1 / Math.tan(cam.fov / 2);
        const r = (cloud.s * f * scale) / c.depth;
        if (r < 2) return;
        const cx = toX(c.x);
        const cy = toY(c.y);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.38, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - r * 0.55, cy + r * 0.08, r * 0.6, r * 0.28, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + r * 0.55, cy + r * 0.08, r * 0.6, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  }

  items.sort((a, b) => b.depth - a.depth);
  for (const item of items) item.draw();

  // Runway decal pass: paint the asphalt over the terrain it sits on.
  for (const draw of runwayDraws) draw();

  // Contact shadow: a dark quad on the ground under the plane, fading with
  // height, so the plane reads as sitting on the runway instead of floating.
  // Not drawn after a crash — there is no plane to cast it.
  if (cameraMode !== 'cockpit' && state.mode !== 'crashed') {
    const groundY = terrain.heightAt(plane.pos.x, plane.pos.z);
    const alt = Math.max(0, plane.pos.y - groundY);
    const alpha = 0.28 / (1 + alt / 60);
    if (alpha > 0.02) {
      const h = plane.heading;
      const fx = Math.sin(h), fz = -Math.cos(h);
      const rx = Math.cos(h), rz = Math.sin(h);
      const cx = plane.pos.x, cz = plane.pos.z, cy = groundY + 0.3;
      const shadow = projectClipped(cam, [
        { x: cx - rx * 2 - fx * 6, y: cy, z: cz - rz * 2 - fz * 6 },
        { x: cx + rx * 2 - fx * 6, y: cy, z: cz + rz * 2 - fz * 6 },
        { x: cx + rx * 2 + fx * 6, y: cy, z: cz + rz * 2 + fz * 6 },
        { x: cx - rx * 2 + fx * 6, y: cy, z: cz - rz * 2 + fz * 6 },
      ]);
      if (shadow) {
        ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(toX(shadow[0].x), toY(shadow[0].y));
        for (let i = 1; i < shadow.length; i++) ctx.lineTo(toX(shadow[i].x), toY(shadow[i].y));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // The plane itself, in chase view, drawn last and closest. After a
  // crash it is gone — the scene behind the crash screen is just the sea
  // and sky where it went down.
  if (cameraMode !== 'cockpit' && state.mode !== 'crashed') drawPlane(ctx, cam, plane, time, toX, toY, scale);
}

// The Kestrel K-2: a red-and-cream bush plane, built from flat polygons.
function drawPlane(ctx, cam, plane, time, toX, toY, scale) {
  const basis = planeBasis(plane);
  const polys = [
    // Fuselage top (red).
    { pts: [[-0.55, 0.35, -2.6], [0.55, 0.35, -2.6], [0.5, 0.5, 1.2], [-0.5, 0.5, 1.2]], color: COLORS.planeRed },
    { pts: [[-0.5, 0.5, 1.2], [0.5, 0.5, 1.2], [0.35, 0.42, 2.9], [-0.35, 0.42, 2.9]], color: COLORS.planeRed },
    // Fuselage sides (cream).
    { pts: [[-0.55, -0.35, -2.6], [-0.55, 0.35, -2.6], [-0.5, 0.5, 1.2], [-0.5, -0.3, 1.2]], color: COLORS.planeCream },
    { pts: [[0.55, -0.35, -2.6], [0.55, 0.35, -2.6], [0.5, 0.5, 1.2], [0.5, -0.3, 1.2]], color: COLORS.planeCream },
    // Belly.
    { pts: [[-0.55, -0.35, -2.6], [0.55, -0.35, -2.6], [0.5, -0.3, 1.2], [-0.5, -0.3, 1.2]], color: '#8a2f2a' },
    // Canopy (dark glass).
    { pts: [[-0.42, 0.38, -1.4], [0.42, 0.38, -1.4], [0.4, 0.62, -0.3], [-0.4, 0.62, -0.3]], color: '#22303c' },
    // Main wing (red, cream tips).
    { pts: [[-5.6, 0.05, -0.9], [-5.6, 0.05, 0.7], [-0.6, 0.12, 0.7], [-0.6, 0.12, -0.9]], color: COLORS.planeRed },
    { pts: [[0.6, 0.12, -0.9], [0.6, 0.12, 0.7], [5.6, 0.05, 0.7], [5.6, 0.05, -0.9]], color: COLORS.planeRed },
    { pts: [[-5.6, 0.05, -0.9], [-4.9, 0.05, -0.9], [-4.9, 0.05, 0.7], [-5.6, 0.05, 0.7]], color: COLORS.planeCream },
    { pts: [[4.9, 0.05, -0.9], [5.6, 0.05, -0.9], [5.6, 0.05, 0.7], [4.9, 0.05, 0.7]], color: COLORS.planeCream },
    // Tailplane.
    { pts: [[-1.9, 0.32, 2.4], [-1.9, 0.32, 3.1], [1.9, 0.32, 3.1], [1.9, 0.32, 2.4]], color: COLORS.planeRed },
    // Fin.
    { pts: [[0, 0.4, 2.2], [0, 1.5, 2.6], [0, 1.5, 3.1], [0, 0.4, 3.1]], color: COLORS.planeRed },
    // Fin side faces (thin, drawn as quads offset in x so they show).
    { pts: [[-0.03, 0.4, 2.2], [-0.03, 1.5, 2.6], [-0.03, 1.5, 3.1], [-0.03, 0.4, 3.1]], color: '#b2342e' },
    { pts: [[0.03, 0.4, 2.2], [0.03, 1.5, 2.6], [0.03, 1.5, 3.1], [0.03, 0.4, 3.1]], color: '#b2342e' },
  ];
  // Spinning prop at the nose: a translucent disc plus two blades. They
  // join the depth-sorted polygon list, so from behind the fuselage covers
  // the disc's centre and only the rim and blade tips show past its
  // silhouette.
  const propAngle = time * 22;
  const disc = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    disc.push([Math.cos(a) * 1.35, 0.05 + Math.sin(a) * 1.35, -3.1]);
  }
  polys.push({ pts: disc, color: 'rgba(40,40,40,0.15)' });
  for (const a of [propAngle, propAngle + Math.PI]) {
    const dir = [Math.cos(a), Math.sin(a)];
    const perp = [-Math.sin(a), Math.cos(a)];
    const w = 0.06;
    polys.push({
      pts: [
        [dir[0] * 0.15 - perp[0] * w, 0.05 + dir[1] * 0.15 - perp[1] * w, -3.12],
        [dir[0] * 1.3 - perp[0] * w, 0.05 + dir[1] * 1.3 - perp[1] * w, -3.12],
        [dir[0] * 1.3 + perp[0] * w, 0.05 + dir[1] * 1.3 + perp[1] * w, -3.12],
        [dir[0] * 0.15 + perp[0] * w, 0.05 + dir[1] * 0.15 + perp[1] * w, -3.12],
      ],
      color: 'rgba(30,30,30,0.7)',
    });
  }
  const projected = polys.map((poly) => {
    const world = poly.pts.map(([lx, ly, lz]) => localToWorld(plane, basis, lx, ly, lz));
    const pts = projectClipped(cam, world);
    const depth = world.reduce((s, q) => s + dot(sub(q, cam.pos), cam.forward), 0) / world.length;
    return { pts, color: poly.color, depth };
  });
  projected.sort((a, b) => b.depth - a.depth);
  for (const poly of projected) {
    if (!poly.pts) continue;
    ctx.fillStyle = poly.color;
    ctx.beginPath();
    ctx.moveTo(toX(poly.pts[0].x), toY(poly.pts[0].y));
    for (let i = 1; i < poly.pts.length; i++) ctx.lineTo(toX(poly.pts[i].x), toY(poly.pts[i].y));
    ctx.closePath();
    ctx.fill();
  }
  // Landing gear, when down.
  if (plane.gear) {
    for (const side of [-1, 1]) {
      const wheel = localToWorld(plane, basis, side * 0.7, -0.75, -0.6);
      const wp = projectPoint(cam, wheel);
      if (wp.behind) continue;
      const f = 1 / Math.tan(cam.fov / 2);
      const r = Math.max(2, (0.32 * f * scale) / wp.depth);
      ctx.fillStyle = '#1c1c1c';
      ctx.beginPath();
      ctx.arc(toX(wp.x), toY(wp.y), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
