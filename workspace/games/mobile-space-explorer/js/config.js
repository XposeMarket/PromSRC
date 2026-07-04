export const PLANETS = [
  { id: 'ember', name: 'Ember Reach', color: 0xff6b35, biome: 'lava', radius: 28, position: [420, 40, -180] },
  { id: 'frost', name: 'Frost Veil', color: 0xa8d8ff, biome: 'tundra', radius: 34, position: [-520, -60, 220] },
  { id: 'jade', name: 'Jade Hollow', color: 0x3ecf6e, biome: 'jungle', radius: 30, position: [80, 120, 480] },
  { id: 'dune', name: 'Dune Crown', color: 0xe8c547, biome: 'desert', radius: 26, position: [-200, -30, -420] },
];

export const GALAXY = {
  bounds: 900,
  asteroidCount: 140,
  starCount: 6000,
  planetTriggerDist: 1.35,
};

export const SHIP = {
  maxHull: 100,
  maxBoost: 100,
  boostDrain: 38,
  boostRegen: 18,
  galaxySpeed: 42,
  boostMult: 2.1,
  collisionDamage: 12,
  asteroidDamage: 8,
};

export const BIOME_SIZE = 220;