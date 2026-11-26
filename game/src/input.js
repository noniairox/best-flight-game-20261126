// Keyboard and mouse input for Sky Courier. Arrow keys fly the plane,
// Shift/Ctrl work the throttle, G/F/B handle gear, flaps and brakes,
// C swaps the camera, P pauses, R restarts, M mutes. The mouse steers
// while its button is held. Edge actions (toggles) are consumed once.

export const KEY_ACTIONS = {
  // Arcade mapping: Up climbs, Down descends — the arrow points where the
  // nose goes. (Flight-sim players expect the reverse; the title screen
  // says "ARROWS fly" and the README spells it out.)
  ArrowUp: 'climb',
  KeyW: 'climb',
  ArrowDown: 'descend',
  KeyS: 'descend',
  ArrowLeft: 'bankLeft',
  KeyA: 'bankLeft',
  ArrowRight: 'bankRight',
  KeyD: 'bankRight',
  ShiftLeft: 'throttleUp',
  ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown',
  ControlRight: 'throttleDown',
  KeyB: 'brakes',
  KeyF: 'flaps',
  KeyG: 'gear',
  KeyC: 'camera',
  KeyP: 'pause',
  Escape: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
  Enter: 'confirm',
  Space: 'confirm',
  Digit1: 'mission1',
  Digit2: 'mission2',
  Digit3: 'mission3',
};

export function createInput() {
  const held = new Set();
  const pressed = new Set();
  const mouse = { active: false, dx: 0, dy: 0 };

  const input = {
    // Continuous state, read every frame by the flight model.
    get pitch() {
      let v = 0;
      if (held.has('climb')) v += 1;
      if (held.has('descend')) v -= 1;
      if (mouse.active) v -= mouse.dy / 120;
      return Math.max(-1, Math.min(1, v));
    },
    get roll() {
      let v = 0;
      if (held.has('bankRight')) v += 1;
      if (held.has('bankLeft')) v -= 1;
      if (mouse.active) v += mouse.dx / 120;
      return Math.max(-1, Math.min(1, v));
    },
    get throttleUp() {
      return held.has('throttleUp');
    },
    get throttleDown() {
      return held.has('throttleDown');
    },
    get brakes() {
      return held.has('brakes');
    },
    // Edge actions: true once per key press, until consumed.
    consume(action) {
      if (pressed.has(action)) {
        pressed.delete(action);
        return true;
      }
      return false;
    },
    // Testable entry points (also wired to real DOM events below).
    keyDown(code) {
      const action = KEY_ACTIONS[code];
      if (!action) return;
      if (!held.has(action)) pressed.add(action);
      held.add(action);
    },
    keyUp(code) {
      const action = KEY_ACTIONS[code];
      if (action) held.delete(action);
    },
    mouseDown(x, y) {
      mouse.active = true;
      mouse.dx = 0;
      mouse.dy = 0;
      mouse.x0 = x;
      mouse.y0 = y;
    },
    mouseMove(x, y) {
      if (!mouse.active) return;
      mouse.dx = Math.max(-120, Math.min(120, x - mouse.x0));
      mouse.dy = Math.max(-120, Math.min(120, y - mouse.y0));
    },
    mouseUp() {
      mouse.active = false;
      mouse.dx = 0;
      mouse.dy = 0;
    },
    attach(target) {
      target.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
        input.keyDown(e.code);
      });
      target.addEventListener('keyup', (e) => input.keyUp(e.code));
      target.addEventListener('blur', () => held.clear());
    },
    attachMouse(canvas) {
      canvas.addEventListener('mousedown', (e) => input.mouseDown(e.clientX, e.clientY));
      canvas.addEventListener('mousemove', (e) => input.mouseMove(e.clientX, e.clientY));
      canvas.addEventListener('mouseup', () => input.mouseUp());
      canvas.addEventListener('mouseleave', () => input.mouseUp());
    },
  };

  if (typeof window !== 'undefined') {
    input.attach(window);
  }
  return input;
}
