import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPlane } from '../game/src/physics.js';
import { createTerrain } from '../game/src/terrain.js';
import { MISSIONS, createMissionRun, updateMission, scoreLanding } from '../game/src/missions.js';

const terrain = createTerrain(1337);

function planeAt(x, y, z) {
  const p = createPlane({ x, y, z, headingDeg: 0 });
  p.airborne = true;
  p.speed = 60;
  return p;
}

describe('MISSIONS definitions', () => {
  it('defines three missions with different goals', () => {
    assert.equal(MISSIONS.length, 3);
    const ids = MISSIONS.map((m) => m.id);
    assert.deepEqual(ids, ['ring-run', 'island-hop', 'storm-courier']);
    assert.ok(MISSIONS.every((m) => m.objectives.length > 0));
    assert.equal(MISSIONS[0].objectives.filter((o) => o.type === 'ring').length, 8);
    assert.equal(MISSIONS[0].objectives.at(-1).type, 'land', 'ring run ends with a landing');
    assert.ok(MISSIONS[1].objectives.some((o) => o.type === 'land'));
    assert.ok(MISSIONS[2].windSpeed > MISSIONS[0].windSpeed, 'storm mission should be windier');
  });
});

describe('createMissionRun / updateMission ring objectives', () => {
  it('advances and scores when flying through the next ring', () => {
    const mission = MISSIONS[0];
    const run = createMissionRun(mission, terrain);
    const ring = mission.objectives[0].ring;
    const p = planeAt(ring.x, ring.y, ring.z);
    const ev = updateMission(run, p, 1 / 60, terrain);
    assert.equal(ev.ringHit, true);
    assert.equal(run.objectiveIndex, 1);
    assert.equal(run.score, 100);
    assert.equal(run.ringsHit, 1);
  });

  it('does not advance when flying far from the next ring', () => {
    const mission = MISSIONS[0];
    const run = createMissionRun(mission, terrain);
    const p = planeAt(0, 300, 1000);
    const ev = updateMission(run, p, 1 / 60, terrain);
    assert.equal(ev.ringHit, false);
    assert.equal(run.objectiveIndex, 0);
    assert.equal(run.score, 0);
  });

  it('does not score the same ring twice', () => {
    const mission = MISSIONS[0];
    const run = createMissionRun(mission, terrain);
    const ring = mission.objectives[0].ring;
    const p = planeAt(ring.x, ring.y, ring.z);
    updateMission(run, p, 1 / 60, terrain);
    const ev = updateMission(run, p, 1 / 60, terrain);
    assert.equal(ev.ringHit, false);
    assert.equal(run.score, 100);
  });

  it('tops up fuel on a ring hit', () => {
    const mission = MISSIONS[0];
    const run = createMissionRun(mission, terrain);
    const ring = mission.objectives[0].ring;
    const p = planeAt(ring.x, ring.y, ring.z);
    p.fuel = 50;
    updateMission(run, p, 1 / 60, terrain);
    assert.ok(p.fuel > 50, `ring should add fuel, got ${p.fuel}`);
  });

  it('caps the ring fuel bonus at a full tank', () => {
    const mission = MISSIONS[0];
    const run = createMissionRun(mission, terrain);
    const ring = mission.objectives[0].ring;
    const p = planeAt(ring.x, ring.y, ring.z);
    p.fuel = 98;
    updateMission(run, p, 1 / 60, terrain);
    assert.equal(p.fuel, 100, `fuel should cap at 100, got ${p.fuel}`);
  });

  it('completes when all rings are flown and the plane lands home', () => {
    const mission = MISSIONS[0];
    const run = createMissionRun(mission, terrain);
    const ringObjectives = mission.objectives.filter((o) => o.type === 'ring');
    for (const obj of ringObjectives) {
      const p = planeAt(obj.ring.x, obj.ring.y, obj.ring.z);
      updateMission(run, p, 1 / 60, terrain);
    }
    assert.equal(run.objectiveIndex, ringObjectives.length);
    // final objective is landing home
    const home = terrain.runways.find((r) => r.id === 'home');
    const p = planeAt(home.center.x, home.elevation, home.center.z);
    p.landed = true;
    const ev = updateMission(run, p, 1 / 60, terrain);
    assert.equal(ev.missionComplete, true);
    assert.equal(run.status, 'complete');
    assert.ok(run.score > mission.objectives.length * 100, 'landing should add points');
  });
});

describe('island-hop landing legs', () => {
  it('advances a leg when landing on the target strip', () => {
    const mission = MISSIONS[1];
    const run = createMissionRun(mission, terrain);
    const landObj = mission.objectives.find((o) => o.type === 'land');
    const strip = terrain.runways.find((r) => r.id === landObj.runwayId);
    const p = planeAt(strip.center.x, strip.elevation, strip.center.z);
    p.landed = true;
    const ev = updateMission(run, p, 1 / 60, terrain);
    assert.equal(ev.legComplete, true);
    assert.equal(run.objectiveIndex, 1);
  });

  it('does not advance when landing on the wrong strip', () => {
    const mission = MISSIONS[1];
    const run = createMissionRun(mission, terrain);
    const home = terrain.runways.find((r) => r.id === 'home');
    const p = planeAt(home.center.x, home.elevation, home.center.z);
    p.landed = true;
    const ev = updateMission(run, p, 1 / 60, terrain);
    assert.equal(ev.legComplete, false);
    assert.equal(run.objectiveIndex, 0);
  });
});

describe('scoreLanding', () => {
  it('rewards a soft, centered, slow touchdown most', () => {
    const home = terrain.runways.find((r) => r.id === 'home');
    const best = scoreLanding({ centerOffset: 0, verticalSpeed: -1, speed: 28 }, home);
    const sloppy = scoreLanding({ centerOffset: 8, verticalSpeed: -3, speed: 42 }, home);
    assert.ok(best > sloppy, `best ${best} should beat sloppy ${sloppy}`);
    assert.ok(best >= 400, `great landing should pay well: ${best}`);
    assert.ok(sloppy >= 0, 'sloppy landing still counts if it survived');
  });
});
