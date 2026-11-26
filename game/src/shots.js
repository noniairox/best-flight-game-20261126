// Screenshot poses for Sky Courier: deterministic scenes for the entry's
// screenshots, chosen with ?shot=start|play|cockpit|end. Each pose sets the
// plane, mission and camera so a capture shows the game at its best.
// The game never depends on these poses to play.

import { createMissionRun } from './missions.js';
import { MISSIONS } from './missions.js';

export function applyShot(game, name, helpers) {
  const { startMission, spawnPlane } = helpers;
  if (name === 'start') {
    // Title screen, plane parked on the runway, camera orbiting.
    game.mode = 'title';
    game.missionIndex = 0;
    game.plane = spawnPlane(MISSIONS[0]);
    game.run = createMissionRun(MISSIONS[0], helpers.terrain);
    game.time = 8;
    return;
  }
  if (name === 'play' || name === 'cockpit') {
    // Mid-flight on Ring Run: through the first ring's approach, chase view.
    // The cockpit pose is a final approach instead, so the home runway
    // reads clearly ahead under the nose.
    startMission(0);
    const p = game.plane;
    if (name === 'cockpit') {
      // On approach to the home runway, low and far enough out that the
      // strip reads above the instrument panel (from closer/higher it
      // falls behind the panel).
      p.pos = { x: 0, y: 30, z: 900 };
      p.heading = 0;
      p.pitch = -0.02;
      p.roll = 0;
      p.speed = 55;
      p.throttle = 0.55;
      p.fuel = 82;
      p.airborne = true;
      p.gear = true;
      p.flaps = true;
      game.cameraMode = 'cockpit';
    } else {
      p.pos = { x: -60, y: 128, z: -60 };
      p.heading = 0;
      p.pitch = 0.02;
      p.roll = 0.08;
      p.speed = 62;
      p.throttle = 0.7;
      p.fuel = 82;
      p.airborne = true;
      game.cameraMode = 'chase';
    }
    game.time = 3;
    return;
  }
  if (name === 'end') {
    // Mission complete: all rings flown, landed home, score on the board.
    startMission(0);
    game.run.ringsHit = 8;
    game.run.landings = 1;
    game.run.score = 1240;
    game.run.elapsed = 184;
    game.run.status = 'complete';
    game.run.objectiveIndex = game.run.mission.objectives.length;
    game.plane.fuel = 34;
    game.plane.landed = true;
    game.plane.pos = { x: 0, y: 6, z: 620 };
    game.mode = 'complete';
    game.isBest = true;
    game.time = 3;
  }
}
