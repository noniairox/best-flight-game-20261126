import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlane, stepPlane, speedKnots, altitudeFt, headingDeg,
} from '../game/src/physics.js';
import { createTerrain } from '../game/src/terrain.js';

const terrain = createTerrain(1337);
const home = terrain.runways.find((r) => r.id === 'home');
const noWind = { x: 0, z: 0 };
const idle = { pitch: 0, roll: 0, throttleUp: false, throttleDown: false, brakes: false };

function airbornePlane(speed = 60) {
  const p = createPlane({ x: 0, y: 200, z: 0, headingDeg: 0 });
  p.speed = speed;
  p.throttle = 0.6;
  p.airborne = true;
  return p;
}

describe('createPlane', () => {
  it('spawns on the runway at rest with full fuel', () => {
    const p = createPlane({ x: home.center.x, y: home.elevation, z: home.center.z, headingDeg: home.headingDeg });
    assert.equal(p.speed, 0);
    assert.equal(p.fuel, 100);
    assert.equal(p.airborne, false);
    assert.equal(p.gear, true);
    assert.equal(p.crashed, null);
  });
});

describe('stepPlane throttle and speed', () => {
  it('accelerates toward max speed at full throttle', () => {
    const p = airbornePlane(10);
    for (let i = 0; i < 600; i++) stepPlane(p, { ...idle, throttleUp: true }, 1 / 60, terrain, noWind);
    assert.ok(p.speed > 70, `expected fast, got ${p.speed}`);
    assert.ok(p.speed <= 95, `too fast: ${p.speed}`);
  });

  it('slows down at idle throttle', () => {
    const p = airbornePlane(80);
    p.throttle = 0;
    for (let i = 0; i < 300; i++) stepPlane(p, idle, 1 / 60, terrain, noWind);
    assert.ok(p.speed < 40, `expected slowdown, got ${p.speed}`);
  });

  it('burns fuel in proportion to throttle', () => {
    const p = airbornePlane(60);
    const start = p.fuel;
    for (let i = 0; i < 600; i++) stepPlane(p, { ...idle, throttleUp: true }, 1 / 60, terrain, noWind);
    const burned = start - p.fuel;
    assert.ok(burned > 2 && burned < 8, `fuel burn odd: ${burned}`);
  });

  it('runs out of fuel: throttle forced to zero', () => {
    const p = airbornePlane(60);
    p.fuel = 0.01;
    for (let i = 0; i < 300; i++) stepPlane(p, { ...idle, throttleUp: true }, 1 / 60, terrain, noWind);
    assert.equal(p.throttle, 0);
    assert.ok(p.fuel <= 0.01);
  });
});

describe('stepPlane pitch, roll and turns', () => {
  it('climbs when pitching up at speed', () => {
    const p = airbornePlane(70);
    const y0 = p.pos.y;
    for (let i = 0; i < 180; i++) stepPlane(p, { ...idle, pitch: 1 }, 1 / 60, terrain, noWind);
    assert.ok(p.pos.y > y0 + 20, `expected climb, y ${y0} -> ${p.pos.y}`);
    assert.ok(p.pitch > 0.1, `pitch should be up: ${p.pitch}`);
  });

  it('turns right when banked right', () => {
    const p = airbornePlane(65);
    const h0 = p.heading;
    for (let i = 0; i < 240; i++) stepPlane(p, { ...idle, roll: 1 }, 1 / 60, terrain, noWind);
    assert.ok(p.heading > h0 + 0.2, `heading should increase, ${h0} -> ${p.heading}`);
    assert.ok(p.roll > 0.2, `roll should be right: ${p.roll}`);
  });

  it('stalls below stall speed: sinks and flags stalled', () => {
    const p = airbornePlane(15);
    p.throttle = 0;
    let stalled = false;
    const y0 = p.pos.y;
    for (let i = 0; i < 180; i++) {
      const ev = stepPlane(p, idle, 1 / 60, terrain, noWind);
      if (ev.stalled) stalled = true;
    }
    assert.ok(stalled, 'expected stall flag at low speed');
    assert.ok(p.pos.y < y0, `stall should sink the plane, y ${y0} -> ${p.pos.y}`);
  });
});

describe('stepPlane ground, landing and crashes', () => {
  it('takes off from the runway and becomes airborne', () => {
    const p = createPlane({ x: home.center.x, y: home.elevation, z: home.center.z, headingDeg: home.headingDeg });
    let airborne = false;
    for (let i = 0; i < 60 * 20; i++) {
      // rotate once past rotation speed, like a real takeoff
      stepPlane(p, { ...idle, throttleUp: true, pitch: p.speed > 32 ? 1 : 0 }, 1 / 60, terrain, noWind);
      if (p.airborne) { airborne = true; break; }
    }
    assert.ok(airborne, 'plane should lift off the runway');
  });

  it('lands gently on the runway: landed, not crashed', () => {
    // stabilized approach: 250 m out, 25 m above the strip, gentle descent
    const p = createPlane({ x: home.center.x, y: home.elevation + 25, z: home.center.z + home.length / 2 + 250, headingDeg: home.headingDeg });
    p.speed = 38;
    p.throttle = 0.4;
    p.airborne = true;
    p.pitch = -0.08;
    let landed = false;
    for (let i = 0; i < 60 * 30 && !p.crashed; i++) {
      const ev = stepPlane(p, idle, 1 / 60, terrain, noWind);
      if (ev.landed) { landed = true; break; }
    }
    assert.ok(landed, 'gentle runway touchdown should land');
    assert.equal(p.crashed, null);
  });

  it('a hard landing on the runway crashes', () => {
    // Steep approach from close in: 40 m up, 70 m short of the strip,
    // diving at about -6 m/s, past the survivable -4.5 m/s.
    const p = createPlane({ x: home.center.x, y: home.elevation + 40, z: home.center.z + home.length / 2 + 70, headingDeg: home.headingDeg });
    p.speed = 38;
    p.throttle = 0.5;
    p.airborne = true;
    p.pitch = -0.18;
    for (let i = 0; i < 60 * 30 && !p.crashed; i++) stepPlane(p, idle, 1 / 60, terrain, noWind);
    assert.ok(p.crashed, 'hard landing should crash');
    assert.match(p.crashed, /hard/i);
  });

  it('gear-up landing on the runway crashes', () => {
    const p = createPlane({ x: home.center.x, y: home.elevation + 25, z: home.center.z + home.length / 2 + 250, headingDeg: home.headingDeg });
    p.speed = 38;
    p.throttle = 0.4;
    p.airborne = true;
    p.pitch = -0.08;
    p.gear = false;
    for (let i = 0; i < 60 * 30 && !p.crashed; i++) stepPlane(p, idle, 1 / 60, terrain, noWind);
    assert.ok(p.crashed, 'gear-up landing should crash');
    assert.match(p.crashed, /gear/i);
  });

  it('flying into a hillside crashes', () => {
    const p = createPlane({ x: 150, y: 80, z: -150, headingDeg: 0 });
    p.speed = 60;
    p.airborne = true;
    p.pitch = -0.3;
    for (let i = 0; i < 60 * 10 && !p.crashed; i++) stepPlane(p, idle, 1 / 60, terrain, noWind);
    assert.ok(p.crashed, 'hillside impact should crash');
  });

  it('ditching in the sea crashes', () => {
    const p = createPlane({ x: 0, y: 40, z: 1150, headingDeg: 180 });
    p.speed = 50;
    p.airborne = true;
    p.pitch = -0.2;
    for (let i = 0; i < 60 * 10 && !p.crashed; i++) stepPlane(p, idle, 1 / 60, terrain, noWind);
    assert.ok(p.crashed, 'sea ditching should crash');
    assert.match(p.crashed, /sea|water|ditch/i);
  });
});

describe('display helpers', () => {
  it('converts speed to knots and altitude to feet', () => {
    const p = airbornePlane(60);
    p.pos.y = 100;
    assert.ok(Math.abs(speedKnots(p) - 60 * 1.94384) < 0.01);
    assert.ok(Math.abs(altitudeFt(p) - 100 * 3.28084) < 0.01);
    assert.equal(Math.round(headingDeg(p)), 0);
  });
});
