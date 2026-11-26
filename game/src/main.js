// Sky Courier: game loop, state machine and wiring. Title, flying, pause,
// mission complete and crash states, camera smoothing, wind and gusts,
// best scores in localStorage, and the ?shot= poses for screenshots.

import { GAME } from './config.js';
import { createTerrain } from './terrain.js';
import { createPlane, stepPlane, runwayAt } from './physics.js';
import { MISSIONS, createMissionRun, updateMission } from './missions.js';
import {
  lookAt,
  makeChaseCamera,
  makeCockpitCamera,
  createClouds,
  drawScene,
} from './render.js';
import { drawHUD, drawCockpitPanel, drawTitle, drawPaused, drawComplete, drawCrashed } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { applyShot } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const terrain = createTerrain(GAME.seed);
const clouds = createClouds(GAME.seed);
const input = createInput();
input.attachMouse(canvas);
const audio = createAudio();

const BEST_KEY = 'skycourier.best.v1';

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveBest(best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // Storage may be unavailable; best scores are a nice-to-have.
  }
}

const home = terrain.runways.find((r) => r.id === 'home');

const game = {
  mode: 'title', // title | flying | paused | complete | crashed
  missionIndex: 0,
  best: loadBest(),
  plane: null,
  run: null,
  cameraMode: 'chase',
  cam: null,
  camSmooth: null,
  time: 0,
  frozen: false,
  crashReason: null,
  isBest: false,
  wind: { x: 0, z: 0 },
  windLabel: 'CALM',
};

function spawnPlane(mission) {
  const plane = createPlane({
    x: home.center.x,
    y: home.elevation,
    z: home.center.z,
    headingDeg: home.headingDeg,
  });
  plane.fuel = mission.fuel;
  return plane;
}

function startMission(index) {
  const mission = MISSIONS[index];
  game.missionIndex = index;
  game.plane = spawnPlane(mission);
  game.run = createMissionRun(mission, terrain);
  game.mode = 'flying';
  game.cameraMode = 'chase';
  game.crashReason = null;
  game.isBest = false;
  game.cam = makeChaseCamera(game.plane);
  game.camSmooth = game.cam;
  audio.ensure();
  audio.click();
}

function windFor(mission, time) {
  if (!mission.windSpeed) return { x: 0, z: 0, label: 'CALM' };
  const dir = (mission.windDirDeg * Math.PI) / 180;
  const gust = 1 + 0.35 * Math.sin(time * 0.6) + 0.2 * Math.sin(time * 1.7);
  const speed = mission.windSpeed * gust;
  const wx = Math.sin(dir) * speed;
  const wz = -Math.cos(dir) * speed;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const label = `${names[Math.round((((mission.windDirDeg % 360) + 360) % 360) / 45) % 8]} ${Math.round(speed * 1.94)} KT`;
  return { x: wx, z: wz, label };
}

function toMenu() {
  game.mode = 'title';
  game.plane = spawnPlane(MISSIONS[game.missionIndex]);
  game.run = createMissionRun(MISSIONS[game.missionIndex], terrain);
  game.cam = null;
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// Title-screen plane, parked on the runway for the backdrop.
game.plane = spawnPlane(MISSIONS[0]);
game.run = createMissionRun(MISSIONS[0], terrain);

function titleCamera(time) {
  const a = 0.9 + time * 0.12; // start at a three-quarter view of the plane
  const eye = {
    x: game.plane.pos.x + Math.sin(a) * 22,
    y: game.plane.pos.y + 7,
    z: game.plane.pos.z + Math.cos(a) * 22,
  };
  // Aim above the plane so it sits in the lower third, clear of the cards.
  return lookAt(eye, { x: game.plane.pos.x, y: game.plane.pos.y + 7, z: game.plane.pos.z });
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (!game.frozen) game.time += dt;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Edge actions, whatever the mode.
  if (input.consume('mute')) audio.setMuted(!audio.isMuted());
  if (input.consume('mission1') && game.mode === 'title') game.missionIndex = 0;
  if (input.consume('mission2') && game.mode === 'title') game.missionIndex = 1;
  if (input.consume('mission3') && game.mode === 'title') game.missionIndex = 2;

  if (game.mode === 'title') {
    game.cam = titleCamera(game.time);
    if (input.consume('confirm')) startMission(game.missionIndex);
  } else if (game.mode === 'flying') {
    const mission = game.run.mission;
    const wind = windFor(mission, game.time);
    game.wind = wind;
    game.windLabel = wind.label;

    if (input.consume('pause')) {
      game.mode = 'paused';
    } else if (input.consume('restart')) {
      startMission(game.missionIndex);
    } else if (input.consume('camera')) {
      game.cameraMode = game.cameraMode === 'chase' ? 'cockpit' : 'chase';
      audio.click();
    } else {
      if (input.consume('gear')) {
        game.plane.gear = !game.plane.gear;
        audio.click();
      }
      if (input.consume('flaps')) {
        game.plane.flaps = !game.plane.flaps;
        audio.click();
      }
      if (!game.frozen) {
        const ev = stepPlane(game.plane, input, dt, terrain, game.wind);
        const mev = updateMission(game.run, game.plane, dt, terrain);
        if (mev.ringHit) audio.ring();
        if (ev.landed) audio.thud();
        if (mev.missionComplete) {
          game.mode = 'complete';
          audio.fanfare();
          const prev = game.best[mission.id] || 0;
          game.isBest = game.run.score > prev;
          if (game.isBest) {
            game.best[mission.id] = game.run.score;
            saveBest(game.best);
          }
        }
        if (game.plane.crashed) {
          game.mode = 'crashed';
          game.crashReason = game.plane.crashed;
          audio.crash();
        }
        audio.update(game.plane);
      }
    }
    // Camera follows the plane, smoothed so it never snaps.
    const target = game.cameraMode === 'cockpit' ? makeCockpitCamera(game.plane) : makeChaseCamera(game.plane);
    if (!game.camSmooth) game.camSmooth = target;
    const k = 1 - Math.exp(-dt * 7);
    game.camSmooth = {
      pos: {
        x: game.camSmooth.pos.x + (target.pos.x - game.camSmooth.pos.x) * k,
        y: game.camSmooth.pos.y + (target.pos.y - game.camSmooth.pos.y) * k,
        z: game.camSmooth.pos.z + (target.pos.z - game.camSmooth.pos.z) * k,
      },
      forward: target.forward,
      right: target.right,
      up: target.up,
      fov: target.fov,
    };
    game.cam = game.camSmooth;
  } else if (game.mode === 'paused') {
    if (input.consume('pause') || input.consume('confirm')) game.mode = 'flying';
    if (input.consume('restart')) startMission(game.missionIndex);
  } else if (game.mode === 'complete' || game.mode === 'crashed') {
    if (input.consume('restart')) startMission(game.missionIndex);
    if (input.consume('confirm')) toMenu();
  }

  // Render.
  const pullUp =
    game.plane &&
    game.plane.airborne &&
    !game.plane.crashed &&
    game.plane.verticalSpeed < -2 &&
    game.plane.pos.y - terrain.heightAt(game.plane.pos.x, game.plane.pos.z) < 25;
  drawScene(ctx, w, h, {
    cam: game.cam,
    plane: game.plane,
    terrain,
    run: game.run,
    time: game.time,
    clouds,
    cameraMode: game.mode === 'title' ? 'chase' : game.cameraMode,
  });

  const hudState = {
    plane: game.plane,
    run: game.run,
    cameraMode: game.cameraMode,
    time: game.time,
    cam: game.cam,
    windLabel: game.windLabel,
    pullUp,
  };
  if (game.mode === 'flying' || game.mode === 'paused') {
    drawHUD(ctx, w, h, hudState);
    if (game.cameraMode === 'cockpit' && game.mode === 'flying') {
      drawCockpitPanel(ctx, w, h, hudState);
    }
    if (game.mode === 'paused') drawPaused(ctx, w, h);
  } else if (game.mode === 'title') {
    drawTitle(ctx, w, h, {
      missions: MISSIONS,
      selected: game.missionIndex,
      best: game.best,
      time: game.time,
    });
  } else if (game.mode === 'complete') {
    drawHUD(ctx, w, h, hudState);
    drawComplete(ctx, w, h, {
      run: game.run,
      plane: game.plane,
      best: game.best[game.run.mission.id],
      isBest: game.isBest,
    });
  } else if (game.mode === 'crashed') {
    drawCrashed(ctx, w, h, { crashReason: game.crashReason, run: game.run });
  }

  requestAnimationFrame(frame);
}

// Screenshot poses (?shot=start|play|cockpit|end) for the maker's captures.
const shot = new URLSearchParams(window.location.search).get('shot');
if (shot) {
  applyShot(game, shot, { startMission, spawnPlane, terrain });
  game.frozen = shot !== 'start';
}

window.__game = game;
requestAnimationFrame(frame);
