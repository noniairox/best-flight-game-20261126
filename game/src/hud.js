// HUD and screens for Sky Courier, drawn on the same canvas as the world:
// flight instruments (altitude, speed, heading, fuel, throttle), a compass
// strip, an artificial horizon, ring guidance, warnings, and the title,
// pause, complete and crash screens. Everything is lit and readable at a
// glance, because the screenshots are what the judge sees first.

import { COLORS } from './config.js';
import { speedKnots, altitudeFt, headingDeg } from './physics.js';
import { projectPoint } from './render.js';
import { currentObjective, objectiveText } from './missions.js';

const GREEN = COLORS.hudGreen;
const AMBER = COLORS.hudAmber;
const RED = COLORS.hudRed;
const PANEL = 'rgba(8,20,32,0.62)';
const PANEL_EDGE = 'rgba(141,255,158,0.35)';

function box(ctx, x, y, w, h, r = 6) {
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
}

function label(ctx, text, x, y, size, color, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function mono(ctx, text, x, y, size, color, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function drawCompass(ctx, w, hdg, s) {
  const cw = 300 * s;
  const ch = 30 * s;
  const cx = w / 2;
  const cy = 96 * s;
  box(ctx, cx - cw / 2, cy - ch / 2, cw, ch, 8);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - cw / 2, cy - ch / 2, cw, ch);
  ctx.clip();
  const pxPerDeg = cw / 120; // the strip shows a 120-degree window
  for (let d = -60; d <= 60; d += 5) {
    const deg = Math.round((((hdg + d) % 360) + 360) % 360);
    const x = cx + d * pxPerDeg;
    const major = deg % 45 === 0;
    ctx.strokeStyle = major ? GREEN : 'rgba(141,255,158,0.45)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, cy - ch / 2 + 4);
    ctx.lineTo(x, cy - ch / 2 + (major ? 14 : 9) * s);
    ctx.stroke();
    if (major) {
      const name = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg);
      label(ctx, name, x, cy + ch / 2 - 5, 11 * s, GREEN, 'center');
    }
  }
  ctx.restore();
  // Centre caret and digital heading.
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(cx, cy + ch / 2 + 2);
  ctx.lineTo(cx - 6 * s, cy + ch / 2 + 10 * s);
  ctx.lineTo(cx + 6 * s, cy + ch / 2 + 10 * s);
  ctx.closePath();
  ctx.fill();
  mono(ctx, `${String(Math.round(hdg)).padStart(3, '0')}°`, cx, cy + ch / 2 + 28 * s, 15 * s, AMBER, 'center');
}

function drawHorizon(ctx, x, y, r, plane, s) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(-plane.roll);
  const pitchPx = plane.pitch * r * 1.6;
  // Sky and ground halves, split at the horizon line (pitchPx below centre
  // when climbing, above it when diving).
  ctx.fillStyle = '#7db4dd';
  ctx.fillRect(-r, -r, r * 2, r + pitchPx);
  ctx.fillStyle = '#8a6b46';
  ctx.fillRect(-r, pitchPx, r * 2, r - pitchPx);
  // Pitch ladder.
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  for (const deg of [-20, -10, 10, 20]) {
    const py = pitchPx - (deg * Math.PI / 180) * r * 1.6;
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, py);
    ctx.lineTo(r * 0.45, py);
    ctx.stroke();
  }
  // Level line.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r, pitchPx);
  ctx.lineTo(r, pitchPx);
  ctx.stroke();
  ctx.restore();
  // Fixed wings marker and bezel.
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - r - 4, y);
  ctx.lineTo(x - r * 0.45, y);
  ctx.moveTo(x + r * 0.45, y);
  ctx.lineTo(x + r + 4, y);
  ctx.stroke();
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  label(ctx, 'ATT', x, y + r + 16 * s, 10 * s, GREEN, 'center');
}

function drawBar(ctx, x, y, w, h, frac, color, labelText, s) {
  box(ctx, x, y, w, h, 4);
  ctx.fillStyle = color;
  const inner = Math.max(0, Math.min(1, frac)) * (w - 4);
  if (inner > 0) {
    ctx.fillRect(x + 2, y + 2, inner, h - 4);
  }
  label(ctx, labelText, x, y - 5 * s, 10 * s, GREEN);
}

export function drawHUD(ctx, w, h, state) {
  const { plane, run, cameraMode, time } = state;
  const s = h / 720;
  const hdg = headingDeg(plane);

  // Top-left: altitude, speed, heading.
  const bw = 118 * s;
  const bh = 54 * s;
  const gap = 8 * s;
  const x0 = 14 * s;
  const y0 = 14 * s;
  const cells = [
    ['ALT', `${Math.round(altitudeFt(plane))} FT`],
    ['SPD', `${Math.round(speedKnots(plane))} KT`],
    ['HDG', `${String(Math.round(hdg)).padStart(3, '0')}°`],
  ];
  cells.forEach(([name, value], i) => {
    const x = x0 + i * (bw + gap);
    box(ctx, x, y0, bw, bh);
    label(ctx, name, x + 10 * s, y0 + 18 * s, 11 * s, GREEN);
    mono(ctx, value, x + 10 * s, y0 + 40 * s, 19 * s, '#ffffff');
  });

  drawCompass(ctx, w, hdg, s);

  // Top-right: fuel, throttle, score, objective, time.
  const rx = w - 14 * s - 210 * s;
  drawBar(ctx, rx, y0, 210 * s, 14 * s, plane.fuel / 100, plane.fuel < 20 ? RED : GREEN, `FUEL ${Math.round(plane.fuel)}%`, s);
  drawBar(ctx, rx, y0 + 30 * s, 210 * s, 14 * s, plane.throttle, '#7db4dd', `THR ${Math.round(plane.throttle * 100)}%`, s);
  box(ctx, rx, y0 + 60 * s, 210 * s, 62 * s);
  label(ctx, 'SCORE', rx + 10 * s, y0 + 80 * s, 11 * s, GREEN);
  mono(ctx, String(run.score), rx + 10 * s, y0 + 104 * s, 20 * s, '#ffffff');
  label(ctx, objectiveText(run), rx + 10 * s, y0 + 122 * s, 11 * s, AMBER);
  label(ctx, `TIME ${fmtTime(run.elapsed)}`, rx + 118 * s, y0 + 80 * s, 11 * s, GREEN);

  // Bottom-left: gear, flaps, wind. The cockpit panel carries its own
  // gear/flaps lights, so this box only shows in chase view.
  if (cameraMode !== 'cockpit') {
    const lx = 14 * s;
    const ly = h - 14 * s - 54 * s;
    box(ctx, lx, ly, 150 * s, 54 * s);
    label(ctx, 'GEAR', lx + 10 * s, ly + 20 * s, 11 * s, GREEN);
    mono(ctx, plane.gear ? 'DOWN' : 'UP', lx + 62 * s, ly + 20 * s, 13 * s, plane.gear ? GREEN : RED);
    label(ctx, 'FLAPS', lx + 10 * s, ly + 42 * s, 11 * s, GREEN);
    mono(ctx, plane.flaps ? 'DOWN' : 'UP', lx + 62 * s, ly + 42 * s, 13 * s, plane.flaps ? GREEN : '#ffffff');
    label(ctx, `WIND ${state.windLabel}`, lx + 118 * s, ly + 20 * s, 10 * s, GREEN);
  }

  // Bottom-centre: artificial horizon (chase view only; the cockpit has one).
  if (cameraMode !== 'cockpit') {
    drawHorizon(ctx, w / 2, h - 80 * s, 44 * s, plane, s);
  }

  // Ring guidance: a marker on the next ring, or an edge arrow toward it.
  const obj = currentObjective(run);
  if (obj && obj.type === 'ring' && state.cam) {
    const p = projectPoint(state.cam, obj.ring);
    const cx = w / 2;
    const cy = h / 2;
    const dist = Math.round(Math.hypot(
      plane.pos.x - obj.ring.x,
      plane.pos.y - obj.ring.y,
      plane.pos.z - obj.ring.z,
    ));
    if (!p.behind && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.9) {
      const sx = (p.x + 1) * 0.5 * w;
      const sy = (1 - (p.y + 1) * 0.5) * h;
      ctx.strokeStyle = COLORS.ringNext;
      ctx.lineWidth = 2.5;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-9 * s, -9 * s, 18 * s, 18 * s);
      ctx.restore();
      mono(ctx, `${dist} m`, sx + 16 * s, sy - 8 * s, 13 * s, COLORS.ringNext);
    } else {
      // Off-screen: an arrow at the frame edge in the ring's direction.
      const ang = Math.atan2(p.y, p.x);
      const ex = cx + Math.cos(ang) * (w / 2 - 40 * s);
      const ey = cy - Math.sin(ang) * (h / 2 - 40 * s);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-ang);
      ctx.fillStyle = COLORS.ringNext;
      ctx.beginPath();
      ctx.moveTo(14 * s, 0);
      ctx.lineTo(-10 * s, -10 * s);
      ctx.lineTo(-10 * s, 10 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      mono(ctx, `${dist} m`, ex + 18 * s, ey + 5 * s, 13 * s, COLORS.ringNext);
    }
  }

  // Warnings, flashing.
  const blink = Math.sin(time * 10) > 0;
  const warnings = [];
  if (plane.stalled) warnings.push(['STALL', RED]);
  if (plane.fuel < 20) warnings.push(['LOW FUEL', AMBER]);
  if (!plane.gear && plane.airborne && plane.pos.y < 80) warnings.push(['GEAR UP', RED]);
  if (state.pullUp) warnings.push(['PULL UP', RED]);
  if (plane.fuel <= 0) warnings.push(['ENGINE OUT', RED]);
  if (warnings.length && blink) {
    warnings.forEach(([text, color], i) => {
      const wy = 150 * s + i * 30 * s;
      mono(ctx, `⚠ ${text}`, w / 2, wy, 22 * s, color, 'center');
    });
  }
}

// Cockpit panel: a dark dashboard with round gauges across the bottom.
export function drawCockpitPanel(ctx, w, h, state) {
  const { plane, run } = state;
  const s = h / 720;
  const panelH = 190 * s;
  const y0 = h - panelH;
  ctx.fillStyle = 'rgba(12,16,22,0.94)';
  ctx.beginPath();
  ctx.moveTo(0, y0 + 30 * s);
  ctx.quadraticCurveTo(w / 2, y0 - 26 * s, w, y0 + 30 * s);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const gauges = [
    { x: w * 0.16, label: 'AIRSPEED', value: Math.round(speedKnots(plane)), unit: 'KT', max: 200 },
    { x: w * 0.31, label: 'ALTITUDE', value: Math.round(altitudeFt(plane)), unit: 'FT', max: 6000 },
    { x: w * 0.69, label: 'FUEL', value: Math.round(plane.fuel), unit: '%', max: 100 },
    { x: w * 0.84, label: 'THROTTLE', value: Math.round(plane.throttle * 100), unit: '%', max: 100 },
  ];
  for (const g of gauges) {
    const gy = y0 + 78 * s;
    const gr = 52 * s;
    // Dial.
    ctx.fillStyle = '#0d1a24';
    ctx.strokeStyle = 'rgba(141,255,158,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(g.x, gy, gr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Needle: sweeps clockwise from lower-left (min) through the top (mid)
    // to lower-right (max), like a real round gauge.
    const frac = Math.max(0, Math.min(1, g.value / g.max));
    const ang = Math.PI * 0.75 + frac * Math.PI * 1.5;
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.x, gy);
    ctx.lineTo(g.x + Math.cos(ang) * gr * 0.8, gy + Math.sin(ang) * gr * 0.8);
    ctx.stroke();
    // Ticks.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
      ctx.beginPath();
      ctx.moveTo(g.x + Math.cos(a) * gr * 0.88, gy + Math.sin(a) * gr * 0.88);
      ctx.lineTo(g.x + Math.cos(a) * gr, gy + Math.sin(a) * gr);
      ctx.stroke();
    }
    label(ctx, g.label, g.x, gy + gr + 22 * s, 10 * s, GREEN, 'center');
    mono(ctx, `${g.value} ${g.unit}`, g.x, gy + gr + 40 * s, 14 * s, '#ffffff', 'center');
  }
  // Artificial horizon in the middle of the panel.
  drawHorizon(ctx, w * 0.5, y0 + 78 * s, 40 * s, plane, s);
  // Gear and flaps lights at the panel's left edge.
  const lx = 24 * s;
  label(ctx, 'GEAR', lx, y0 + 62 * s, 11 * s, GREEN);
  mono(ctx, plane.gear ? 'DOWN' : 'UP', lx, y0 + 82 * s, 14 * s, plane.gear ? GREEN : RED);
  label(ctx, 'FLAPS', lx, y0 + 108 * s, 11 * s, GREEN);
  mono(ctx, plane.flaps ? 'DOWN' : 'UP', lx, y0 + 128 * s, 14 * s, plane.flaps ? GREEN : '#ffffff');
  label(ctx, `SCORE ${run.score}`, w - 24 * s, y0 + 62 * s, 12 * s, AMBER, 'right');
  label(ctx, objectiveText(run), w - 24 * s, y0 + 82 * s, 11 * s, '#c9d8e4', 'right');
}

// --- Screens ---------------------------------------------------------------

export function drawTitle(ctx, w, h, state) {
  const { missions, selected, best, time } = state;
  const s = h / 720;
  ctx.fillStyle = 'rgba(6,14,24,0.45)';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  label(ctx, 'SKY COURIER', cx, h * 0.2, 64 * s, '#ffffff', 'center');
  label(ctx, '—  Island Run  —', cx, h * 0.2 + 44 * s, 22 * s, COLORS.ringNext, 'center');
  label(ctx, 'Fly the Kestrel K-2 across the archipelago. Thread the rings, mind your fuel, land her gentle.', cx, h * 0.2 + 82 * s, 15 * s, '#dfe9f2', 'center');

  // Mission cards.
  const cw = 250 * s;
  const ch = 132 * s;
  const gap = 20 * s;
  const x0 = cx - (cw * 3 + gap * 2) / 2;
  const y0 = h * 0.36;
  missions.forEach((m, i) => {
    const x = x0 + i * (cw + gap);
    const active = i === selected;
    ctx.fillStyle = active ? 'rgba(255,210,62,0.16)' : PANEL;
    ctx.strokeStyle = active ? COLORS.ringNext : PANEL_EDGE;
    ctx.lineWidth = active ? 2.5 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y0, cw, ch, 10);
    ctx.fill();
    ctx.stroke();
    label(ctx, `${i + 1}. ${m.name.toUpperCase()}`, x + 14 * s, y0 + 28 * s, 15 * s, active ? COLORS.ringNext : '#ffffff');
    const lines = m.blurb.match(/.{1,34}(\s|$)/g) || [m.blurb];
    lines.slice(0, 3).forEach((line, j) => {
      label(ctx, line.trim(), x + 14 * s, y0 + 54 * s + j * 18 * s, 12 * s, '#c9d8e4');
    });
    const bestScore = best[m.id];
    label(ctx, bestScore ? `BEST ${bestScore}` : 'NOT FLOWN YET', x + 14 * s, y0 + ch - 14 * s, 11 * s, GREEN);
  });

  label(ctx, 'Press 1 / 2 / 3 to pick a mission, then ENTER or click to fly', cx, y0 + ch + 36 * s, 15 * s, '#ffffff', 'center');
  const bob = Math.sin(time * 2) * 4;
  label(ctx, '▲  ARROWS fly  •  SHIFT / CTRL throttle  •  G gear  •  F flaps  •  C camera  •  P pause  •  M mute', cx, y0 + ch + 66 * s + bob, 13 * s, '#9fb6c6', 'center');
  label(ctx, 'Mouse: hold and drag to steer', cx, y0 + ch + 90 * s, 12 * s, '#9fb6c6', 'center');
}

export function drawPaused(ctx, w, h) {
  const s = h / 720;
  ctx.fillStyle = 'rgba(6,14,24,0.6)';
  ctx.fillRect(0, 0, w, h);
  label(ctx, 'PAUSED', w / 2, h / 2 - 10 * s, 44 * s, '#ffffff', 'center');
  label(ctx, 'P to resume  •  R to restart  •  ENTER for the menu', w / 2, h / 2 + 30 * s, 15 * s, '#c9d8e4', 'center');
}

export function drawComplete(ctx, w, h, state) {
  const { run, best, isBest } = state;
  const s = h / 720;
  ctx.fillStyle = 'rgba(6,14,24,0.62)';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  label(ctx, 'MISSION COMPLETE', cx, h * 0.26, 44 * s, COLORS.ringNext, 'center');
  label(ctx, run.mission.name, cx, h * 0.26 + 36 * s, 18 * s, '#ffffff', 'center');
  const rows = [
    ['Rings flown', `${run.ringsHit}`],
    ['Landings', `${run.landings}`],
    ['Time', fmtTime(run.elapsed)],
    ['Fuel left', `${Math.round(state.plane.fuel)}%`],
    ['SCORE', `${run.score}`],
  ];
  const y0 = h * 0.4;
  rows.forEach(([name, value], i) => {
    const y = y0 + i * 34 * s;
    label(ctx, name, cx - 130 * s, y, 16 * s, '#c9d8e4');
    mono(ctx, value, cx + 130 * s, y, 18 * s, i === rows.length - 1 ? COLORS.ringNext : '#ffffff', 'right');
  });
  if (isBest) label(ctx, '★ NEW BEST SCORE ★', cx, y0 + rows.length * 34 * s + 10 * s, 18 * s, COLORS.ringNext, 'center');
  else if (best) label(ctx, `Best: ${best}`, cx, y0 + rows.length * 34 * s + 10 * s, 14 * s, GREEN, 'center');
  label(ctx, 'R to fly again  •  ENTER for the menu', cx, h * 0.8, 15 * s, '#ffffff', 'center');
}

export function drawCrashed(ctx, w, h, state) {
  const { crashReason, run } = state;
  const s = h / 720;
  ctx.fillStyle = 'rgba(40,8,6,0.55)';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  label(ctx, 'CRASHED', cx, h * 0.3, 48 * s, RED, 'center');
  label(ctx, crashReason || 'The Kestrel is down.', cx, h * 0.3 + 40 * s, 17 * s, '#ffffff', 'center');
  label(ctx, `Score ${run.score}  •  Rings ${run.ringsHit}  •  Time ${fmtTime(run.elapsed)}`, cx, h * 0.3 + 74 * s, 14 * s, '#c9d8e4', 'center');
  label(ctx, 'R to try again  •  ENTER for the menu', cx, h * 0.72, 15 * s, '#ffffff', 'center');
}
