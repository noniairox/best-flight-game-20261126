// Synthesized sound for Sky Courier: engine hum, wind, ring chimes,
// touchdown thuds and crashes, all from WebAudio oscillators and noise.
// No audio files, no network. Starts on the first user gesture.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let windGain = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);

    // Engine: two detuned saws through a lowpass, pitch follows throttle.
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 58;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineOsc2.start();

    // Wind: looped noise through a bandpass, loudness follows speed.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    noise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    noise.start();
    return true;
  }

  function tone(freq, dur, type = 'sine', vol = 0.25, when = 0) {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    ensure,
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    isMuted() {
      return muted;
    },
    update(plane) {
      if (!ctx || !engineGain || !windGain) return;
      const rpm = 50 + plane.throttle * 95 + plane.speed * 0.35;
      engineOsc.frequency.setTargetAtTime(rpm, ctx.currentTime, 0.08);
      engineOsc2.frequency.setTargetAtTime(rpm * 1.015, ctx.currentTime, 0.08);
      const target = plane.crashed ? 0 : 0.05 + plane.throttle * 0.12;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
      const windTarget = plane.airborne ? Math.min(0.22, plane.speed * 0.0022) : 0;
      windGain.gain.setTargetAtTime(windTarget, ctx.currentTime, 0.15);
    },
    ring() {
      tone(880, 0.35, 'sine', 0.22);
      tone(1318, 0.5, 'sine', 0.18, 0.07);
    },
    thud() {
      tone(90, 0.25, 'sine', 0.4);
      tone(55, 0.4, 'sine', 0.3, 0.02);
    },
    crash() {
      if (!ctx || !master) return;
      const t0 = ctx.currentTime;
      const len = ctx.sampleRate * 0.7;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      src.connect(gain);
      gain.connect(master);
      src.start(t0);
      tone(48, 0.9, 'sine', 0.5);
    },
    click() {
      tone(660, 0.08, 'square', 0.08);
    },
    fanfare() {
      tone(523, 0.25, 'sine', 0.2);
      tone(659, 0.25, 'sine', 0.2, 0.12);
      tone(784, 0.5, 'sine', 0.22, 0.24);
    },
  };
}
