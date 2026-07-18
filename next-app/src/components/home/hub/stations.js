// The destinations, spread far apart across a large open space so flying between
// them feels like real travel. Five nodes sit on a wide ring around the central
// liquid-chrome core; each carries a tall light-beam beacon (drawn in HubScene)
// so you can spot it from across the map and steer toward it.
//
//   pos    — where the node floats (on the ring)
//   cam    — where the camera flies when you dock (just outside the node)
//   look   — what the camera points at while docked (the node)
//   angle  — ring azimuth in radians (used by the radar + waypoint math)

const RING = 42;      // node ring radius — wide, destinations far apart
const APPROACH = 6;   // how far outside the node the camera sits when docked

const onRing = (deg, y = 0) => {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * RING, y, Math.cos(a) * RING];
};
const approachFrom = (deg) => {
  const a = (deg * Math.PI) / 180;
  const r = RING + APPROACH;
  return [Math.sin(a) * r, 1.6, Math.cos(a) * r];
};

const DEFS = [
  { id: 'signin', label: 'Enter', sub: 'Sign in', deg: 0 },
  { id: 'join', label: 'Join', sub: 'Request access', deg: 60 },
  { id: 'features', label: 'Explore', sub: 'What it does', deg: 120 },
  { id: 'pulse', label: 'Pulse', sub: 'See it live', deg: 180 },
  { id: 'app', label: 'Mobile', sub: 'Get the app', deg: 240 },
  { id: 'race', label: 'Race', sub: 'Grand Prix', deg: 300 },
];

export const WORLD_RADIUS = RING + 20; // soft boundary the ship can roam to

export const STATIONS = DEFS.map((d) => ({
  ...d,
  angle: (d.deg * Math.PI) / 180,
  pos: onRing(d.deg),
  cam: approachFrom(d.deg),
  look: onRing(d.deg),
}));

export const STATIONS_BY_ID = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
