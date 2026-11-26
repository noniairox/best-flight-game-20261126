// Tuning constants for Sky Courier: flight feel, fuel, scoring and look.
// One place for every magic number the game balances on.

export const GAME = {
  title: 'SKY COURIER',
  subtitle: 'Island Run',
  planeName: 'Kestrel K-2',
  seed: 1337,
};

export const FLIGHT = {
  maxThrustAccel: 16, // m/s^2 at full throttle
  drag: 0.18, // per-second speed decay factor
  maxSpeed: 88, // m/s, level flight at full throttle — the thrust/drag
  // equilibrium (maxThrustAccel / drag = 16 / 0.18 ≈ 89), not a hard cap
  stallClean: 30, // m/s, flaps up
  stallFlaps: 26, // m/s, flaps down
  rotateSpeed: 32, // m/s, liftoff on the runway
  pitchRate: 0.7, // rad/s at full stick
  pitchMax: 0.55, // rad, about 31 degrees
  rollRate: 1.6, // rad/s at full stick
  rollMax: 1.1, // rad, about 63 degrees
  rollLevelRate: 0.5, // rad/s auto-levelling with no input
  fuelBurn: 0.5, // percent per second at full throttle
  ringFuelBonus: 6, // percent of fuel a ring gives back
  landingMaxVs: -4.5, // m/s, hardest survivable touchdown
  landingMaxSpeed: 48, // m/s, fastest survivable touchdown
  landingMaxRoll: 0.21, // rad, about 12 degrees of bank
};

export const SCORING = {
  ring: 100,
  landingBase: 500,
  landingCenterPenalty: 15, // per metre off centreline
  landingVsPenalty: 40, // per m/s away from a -1 m/s touchdown
  landingSpeedPenalty: 10, // per m/s over 32 m/s
};

export const VIEW = {
  fov: Math.PI / 3, // 60 degrees vertical
  chaseDistance: 14, // metres behind the plane
  chaseHeight: 4.5, // metres above the plane
  lookAhead: 30, // metres ahead of the plane the camera aims at
};

export const COLORS = {
  skyTop: '#2f6fb4',
  skyMid: '#7db4dd',
  skyHorizon: '#f6d9a0',
  sea: '#2a7fa8',
  seaDeep: '#1d5f86',
  sun: '#fff3c4',
  ringNext: '#ffd23e',
  ringDone: '#7ddc8a',
  ringFuture: '#9fc6e8',
  planeRed: '#d8443c',
  planeCream: '#f2e6c8',
  hudGreen: '#8dff9e',
  hudAmber: '#ffc857',
  hudRed: '#ff5a4e',
};
