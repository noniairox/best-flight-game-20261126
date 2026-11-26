// Terrain for Sky Courier: a tropical archipelago built from island bumps
// over a sea plane, with flattened runway pads carved into the hills.
// All heights are metres; sea level is 0. Deterministic per seed.

import { makeNoise2D } from './random.js';

export const WORLD_SIZE = 2400;
export const SEA_LEVEL = 0;

const ISLANDS = [
  { x: 0, z: 0, r: 700, h: 72 }, // main island, home airfield on its south coast
  { x: 700, z: -600, r: 350, h: 58 }, // north-east island
  { x: -650, z: 500, r: 300, h: 55 }, // west island
  { x: -350, z: -750, r: 180, h: 30 }, // north islet
  { x: 850, z: 450, r: 160, h: 26 }, // east islet
];

const DEG = Math.PI / 180;

function rawHeight(noise, x, z) {
  let base = 0;
  for (const isl of ISLANDS) {
    const dx = x - isl.x;
    const dz = z - isl.z;
    const d2 = (dx * dx + dz * dz) / (isl.r * isl.r);
    if (d2 < 4) base += isl.h * Math.exp(-d2 * 2.0);
  }
  if (base <= 1) return 0;
  return base + noise(x, z) * 5;
}

function rectDistance(x, z, runway) {
  const dx = x - runway.center.x;
  const dz = z - runway.center.z;
  const h = runway.headingDeg * DEG;
  const along = dx * Math.sin(h) - dz * Math.cos(h);
  const across = dx * Math.cos(h) + dz * Math.sin(h);
  const ox = Math.max(Math.abs(across) - runway.width / 2, 0);
  const oz = Math.max(Math.abs(along) - runway.length / 2, 0);
  return Math.hypot(ox, oz);
}

export function createTerrain(seed = 1337) {
  const noise = makeNoise2D(seed);

  const runways = [
    {
      id: 'home',
      name: 'Coral Bay',
      center: { x: 0, z: 620 },
      headingDeg: 0,
      length: 320,
      width: 20,
      elevation: 6,
    },
    {
      id: 'north-strip',
      name: 'Palm Ridge',
      center: { x: 700, z: -600 },
      headingDeg: 35,
      length: 200,
      width: 16,
      elevation: 0, // filled in below from the hilltop height
    },
    {
      id: 'west-strip',
      name: 'Turtle Point',
      center: { x: -650, z: 500 },
      headingDeg: -20,
      length: 180,
      width: 16,
      elevation: 0,
    },
  ];
  // Island strips sit at their hilltop height; the home strip is a coastal pad.
  for (const r of runways) {
    if (r.elevation === 0) {
      r.elevation = Math.max(4, Math.round(rawHeight(noise, r.center.x, r.center.z)));
    }
  }

  function heightAt(x, z) {
    const natural = rawHeight(noise, x, z);
    let h = natural <= 0 ? 0 : natural;
    for (const r of runways) {
      const d = rectDistance(x, z, r);
      if (d === 0) return r.elevation;
      if (d < 60) {
        const t = d / 60;
        h = r.elevation + (h - r.elevation) * t * t * (3 - 2 * t);
      }
    }
    return h;
  }

  function isWater(x, z) {
    return heightAt(x, z) <= 0.5;
  }

  return { heightAt, isWater, runways, islands: ISLANDS, seaLevel: SEA_LEVEL };
}

// Colour of terrain at a height, for the renderer: sand, grass, forest, rock.
export function terrainColor(h) {
  if (h <= 1.5) return '#d9c27a'; // sand
  if (h <= 18) return '#7fae56'; // low grass
  if (h <= 45) return '#5d9448'; // grass
  if (h <= 60) return '#3f7a3a'; // forest
  return '#9a8a70'; // warm rock
}
