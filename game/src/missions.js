// Missions for Sky Courier: ring runs, island hops and a storm courier run.
// A mission is a list of objectives — fly a ring, or land on a named strip —
// and a run tracks progress, score and fuel along the way.

import { SCORING } from './config.js';
import { runwayAt } from './physics.js';

export const MISSIONS = [
  {
    id: 'ring-run',
    name: 'Ring Run',
    blurb: 'Thread all 8 rings over the islands, then bring her home to Coral Bay.',
    fuel: 100,
    windSpeed: 0,
    windDirDeg: 0,
    objectives: [
      { type: 'ring', ring: { x: 0, y: 120, z: -200, r: 25 } },
      { type: 'ring', ring: { x: 220, y: 140, z: -420, r: 25 } },
      { type: 'ring', ring: { x: 480, y: 130, z: -350, r: 25 } },
      { type: 'ring', ring: { x: 680, y: 110, z: -580, r: 25 } },
      { type: 'ring', ring: { x: 450, y: 150, z: -780, r: 25 } },
      { type: 'ring', ring: { x: 50, y: 160, z: -700, r: 25 } },
      { type: 'ring', ring: { x: -320, y: 140, z: -420, r: 25 } },
      { type: 'ring', ring: { x: -120, y: 120, z: -80, r: 25 } },
      { type: 'land', runwayId: 'home' },
    ],
  },
  {
    id: 'island-hop',
    name: 'Island Hop',
    blurb: 'Touch down on Palm Ridge and Turtle Point, then home. Short strips, no mistakes.',
    fuel: 100,
    windSpeed: 2,
    windDirDeg: 60,
    objectives: [
      { type: 'land', runwayId: 'north-strip' },
      { type: 'land', runwayId: 'west-strip' },
      { type: 'land', runwayId: 'home' },
    ],
  },
  {
    id: 'storm-courier',
    name: 'Storm Courier',
    blurb: 'Six rings in a gusting crosswind on a near-empty tank. Fly like it matters.',
    fuel: 70,
    windSpeed: 8,
    windDirDeg: 250,
    objectives: [
      { type: 'ring', ring: { x: 0, y: 130, z: -300, r: 25 } },
      { type: 'ring', ring: { x: 300, y: 150, z: -500, r: 25 } },
      { type: 'ring', ring: { x: 600, y: 130, z: -400, r: 25 } },
      { type: 'ring', ring: { x: 350, y: 160, z: -800, r: 25 } },
      { type: 'ring', ring: { x: -100, y: 150, z: -600, r: 25 } },
      { type: 'ring', ring: { x: -250, y: 130, z: -200, r: 25 } },
      { type: 'land', runwayId: 'home' },
    ],
  },
];

export function createMissionRun(mission, terrain) {
  return {
    mission,
    terrain,
    objectiveIndex: 0,
    score: 0,
    ringsHit: 0,
    landings: 0,
    status: 'flying', // flying | complete
    elapsed: 0,
  };
}

export function currentObjective(run) {
  return run.mission.objectives[run.objectiveIndex] ?? null;
}

// Landing points: a soft, centred, slow touchdown pays best. The perfect
// landing is on the centreline, sinking at 1 m/s, touching down at 32 m/s;
// every metre off the centreline, every m/s harder than that, and every
// m/s faster than 32 costs points, down to the 500-point base.
export function scoreLanding(landing, runway) {
  const centerOffset = landing.centerOffset ?? 0;
  const verticalSpeed = landing.verticalSpeed ?? 0;
  const speed = landing.speed ?? 0;
  const points =
    SCORING.landingBase -
    centerOffset * SCORING.landingCenterPenalty -
    Math.abs(verticalSpeed + 1) * SCORING.landingVsPenalty -
    Math.max(0, speed - 32) * SCORING.landingSpeedPenalty;
  return Math.max(0, Math.round(points));
}

function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function updateMission(run, plane, dt, terrain) {
  const events = { ringHit: false, legComplete: false, missionComplete: false, fuelBonus: 0 };
  if (run.status !== 'flying') return events;
  run.elapsed += dt;
  const obj = currentObjective(run);
  if (!obj) return events;

  if (obj.type === 'ring') {
    if (dist3(plane.pos, obj.ring) < obj.ring.r) {
      run.score += SCORING.ring;
      run.ringsHit += 1;
      run.objectiveIndex += 1;
      events.ringHit = true;
      events.fuelBonus = 6;
      plane.fuel = Math.min(100, plane.fuel + 6);
    }
    return events;
  }

  if (obj.type === 'land' && plane.landed) {
    const spot = runwayAt(terrain, plane.pos.x, plane.pos.z);
    if (spot && spot.runway.id === obj.runwayId) {
      const points = scoreLanding(
        { centerOffset: Math.abs(spot.across), verticalSpeed: plane.verticalSpeed, speed: plane.speed },
        spot.runway,
      );
      run.score += points;
      run.landings += 1;
      run.objectiveIndex += 1;
      plane.landed = false; // consume the touchdown so it scores once
      events.legComplete = true;
      if (run.objectiveIndex >= run.mission.objectives.length) {
        run.status = 'complete';
        events.missionComplete = true;
      }
    }
  }
  return events;
}

// Human-readable text for the current objective, for the HUD.
export function objectiveText(run) {
  const obj = currentObjective(run);
  if (!obj) return 'Mission complete';
  if (obj.type === 'ring') {
    const n = run.mission.objectives.filter((o) => o.type === 'ring').length;
    return `Ring ${run.ringsHit + 1} of ${n}`;
  }
  const strip = run.terrain.runways.find((r) => r.id === obj.runwayId);
  return `Land at ${strip ? strip.name : obj.runwayId}`;
}
