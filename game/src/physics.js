// Arcade flight model for Sky Courier: throttle, lift, stall, banked turns,
// fuel, ground roll, takeoffs, landings and crashes. All units are SI
// (metres, seconds, radians); display helpers convert to knots and feet.

import { FLIGHT } from './config.js';

export const KNOTS_PER_MS = 1.94384;
export const FEET_PER_M = 3.28084;

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createPlane(spawn) {
  return {
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    heading: (spawn.headingDeg ?? 0) * DEG,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: 100,
    gear: true,
    flaps: false,
    airborne: false,
    crashed: null,
    landed: false,
    verticalSpeed: 0,
    stalled: false,
  };
}

export function speedKnots(p) {
  return p.speed * KNOTS_PER_MS;
}

export function altitudeFt(p) {
  return p.pos.y * FEET_PER_M;
}

export function headingDeg(p) {
  return (((p.heading / DEG) % 360) + 360) % 360;
}

// Which runway, if any, covers this point; also the offset across the strip.
export function runwayAt(terrain, x, z) {
  for (const r of terrain.runways) {
    const dx = x - r.center.x;
    const dz = z - r.center.z;
    const h = r.headingDeg * DEG;
    const along = dx * Math.sin(h) - dz * Math.cos(h);
    const across = dx * Math.cos(h) + dz * Math.sin(h);
    if (Math.abs(across) <= r.width / 2 && Math.abs(along) <= r.length / 2) {
      return { runway: r, along, across };
    }
  }
  return null;
}

// One physics tick. On the ground the plane follows the terrain and
// rotates once it is fast enough and the stick is pulled back; in the air
// it flies on heading, pitch and speed, stalls below flying speed, and
// meets the ground as a landing (gentle, on a runway, gear down) or as a
// crash (hard, fast, gear-up, into the sea or a hillside).
export function stepPlane(p, input, dt, terrain, wind) {
  const events = { stalled: false, crashed: false, landed: false, landing: null };
  if (p.crashed) return events;

  // Throttle: dead stick once the tanks are dry.
  if (p.fuel <= 0) {
    p.fuel = 0;
    p.throttle = 0;
  } else {
    if (input.throttleUp) p.throttle = clamp(p.throttle + 0.6 * dt, 0, 1);
    if (input.throttleDown) p.throttle = clamp(p.throttle - 0.6 * dt, 0, 1);
  }

  const stallSpeed = p.flaps ? FLIGHT.stallFlaps : FLIGHT.stallClean;
  const authority = clamp(p.speed / 40, 0.35, 1);

  // Stick: pitch and roll, with control authority that grows with speed.
  if (p.airborne || p.speed > 25) {
    p.pitch = clamp(p.pitch + input.pitch * FLIGHT.pitchRate * dt * authority, -FLIGHT.pitchMax, FLIGHT.pitchMax);
    p.roll = clamp(p.roll + input.roll * FLIGHT.rollRate * dt * authority, -FLIGHT.rollMax, FLIGHT.rollMax);
  }
  if (!input.roll) {
    p.roll -= Math.sign(p.roll) * Math.min(Math.abs(p.roll), FLIGHT.rollLevelRate * dt);
  }

  // Coordinated turn: bank right, head right.
  if (p.airborne) {
    p.heading += ((9.8 * Math.tan(p.roll)) / Math.max(p.speed, 20)) * dt;
  } else if (p.speed > 5) {
    p.heading += input.roll * 0.15 * dt; // taxi steering
  }

  // Speed: thrust fights drag and the cost of climbing.
  const accel = p.throttle * FLIGHT.maxThrustAccel - FLIGHT.drag * p.speed - Math.sin(p.pitch) * 9.8;
  p.speed = Math.max(0, p.speed + accel * dt);

  // Stall: below flying speed the nose drops and the plane sinks.
  p.stalled = p.airborne && p.speed < stallSpeed;
  if (p.stalled) {
    events.stalled = true;
    p.pitch = Math.max(p.pitch - 0.5 * dt, -0.35);
  }

  // Fuel burn, proportional to throttle.
  if (p.throttle > 0 && p.fuel > 0) {
    p.fuel = Math.max(0, p.fuel - p.throttle * FLIGHT.fuelBurn * dt);
  }

  // Velocity from heading, pitch and speed; a banked turn costs altitude.
  const cp = Math.cos(p.pitch);
  let vx = Math.sin(p.heading) * p.speed * cp;
  let vz = -Math.cos(p.heading) * p.speed * cp;
  let vy = p.speed * Math.sin(p.pitch);
  if (p.stalled) vy -= (stallSpeed - p.speed) * 0.5;
  if (p.airborne && Math.abs(p.roll) > 0.3) vy -= (Math.abs(p.roll) - 0.3) * 4;
  vx += wind.x;
  vz += wind.z;
  p.verticalSpeed = vy;

  if (!p.airborne) {
    // Ground roll: follow the ground, rotate once fast enough.
    p.pos.x += vx * dt;
    p.pos.z += vz * dt;
    p.pos.y = terrain.heightAt(p.pos.x, p.pos.z);
    if (input.brakes) p.speed = Math.max(0, p.speed - 6 * dt);
    if (p.speed > FLIGHT.rotateSpeed && input.pitch > 0.3) {
      p.airborne = true;
      p.landed = false;
      p.pos.y += 0.5;
    }
    return events;
  }

  p.pos.x += vx * dt;
  p.pos.y += vy * dt;
  p.pos.z += vz * dt;
  const ground = terrain.heightAt(p.pos.x, p.pos.z);
  if (p.pos.y > ground) return events;

  // The plane met the ground: touchdown or impact.
  p.pos.y = ground;
  const spot = runwayAt(terrain, p.pos.x, p.pos.z);
  if (spot) {
    const gentle =
      vy > FLIGHT.landingMaxVs &&
      p.speed < FLIGHT.landingMaxSpeed &&
      Math.abs(p.roll) < FLIGHT.landingMaxRoll &&
      p.gear;
    if (gentle) {
      p.airborne = false;
      p.landed = true;
      p.pitch = 0;
      p.roll = 0;
      events.landed = true;
      events.landing = {
        runwayId: spot.runway.id,
        centerOffset: Math.abs(spot.across),
        verticalSpeed: vy,
        speed: p.speed,
      };
    } else if (!p.gear) {
      p.crashed = 'Gear-up landing — the belly struck the runway';
      events.crashed = true;
    } else if (vy <= FLIGHT.landingMaxVs) {
      p.crashed = 'Hard landing — the airframe broke apart';
      events.crashed = true;
    } else {
      p.crashed = 'Landing too fast — ran off the runway';
      events.crashed = true;
    }
  } else if (terrain.isWater(p.pos.x, p.pos.z)) {
    p.crashed = 'Ditched in the sea';
    events.crashed = true;
  } else {
    p.crashed = 'Flew into the terrain';
    events.crashed = true;
  }
  return events;
}
