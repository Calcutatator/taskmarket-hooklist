const MODIFIERS = [
  'Neon',
  'Void',
  'Glitch',
  'Chrome',
  'Cipher',
  'Null',
  'Static',
  'Neural',
  'Pixel',
  'Wire',
  'Nano',
  'Holo',
  'Flux',
  'Byte',
  'Dark',
  'Ghost',
  'Crypto',
  'Phase',
  'Zero',
  'Binary',
  'Vector',
  'Quantum',
  'Photon',
  'Plasma',
  'Sonic',
  'Cyber',
  'Virtual',
  'Atomic',
  'Solar',
  'Lunar',
  'Stellar',
  'Nova',
  'Proto',
  'Meta',
  'Neo',
  'Trans',
  'Omni',
  'Synth',
  'Code',
  'Data',
  'Grid',
  'Core',
  'Arc',
  'Edge',
  'Sigma',
  'Omega',
  'Psi',
  'Iron',
  'Steel',
  'Carbon',
  'Cobalt',
  'Indigo',
  'Azure',
  'Crimson',
  'Amber',
  'Jade',
  'Obsidian',
  'Violet',
  'Scarlet',
  'Teal',
  'Onyx',
  'Silver',
  'Gold',
  'Copper',
  'Ivory',
  'Ash',
  'Slate',
  'Infra',
  'Sub',
  'Ultra',
  'Hyper',
  'Laser',
  'Turbo',
  'Rogue',
  'Feral',
  'Stray',
  'Phantom',
  'Hollow',
  'Rusted',
  'Fractured',
] as const;

const ATMOSPHERE = [
  'Dream',
  'Drift',
  'Pulse',
  'Wave',
  'Tide',
  'Echo',
  'Bloom',
  'Surge',
  'Dust',
  'Mist',
  'Storm',
  'Ember',
  'Haze',
  'Rift',
  'Veil',
  'Spark',
  'Glow',
  'Blaze',
  'Flash',
  'Burst',
  'Fade',
  'Shift',
  'Warp',
  'Fold',
  'Loop',
  'Coil',
  'Spiral',
  'Prism',
  'Mirror',
  'Shard',
  'Gleam',
  'Shimmer',
  'Dusk',
  'Dawn',
  'Daze',
  'Trance',
  'Slumber',
  'Reverie',
  'Mirage',
  'Vision',
  'Aura',
  'Nimbus',
  'Halo',
  'Vortex',
  'Helix',
  'Matrix',
  'Nexus',
  'Current',
  'Wake',
  'Thread',
  'Weave',
  'Mesh',
  'Static',
  'Noise',
  'Signal',
  'Beacon',
  'Trace',
  'Glyph',
  'Rune',
  'Seal',
  'Shadow',
  'Shroud',
  'Mantle',
  'Cloak',
  'Veil',
  'Wraith',
  'Specter',
  'Shade',
  'Fracture',
  'Hollow',
  'Bloom',
  'Frost',
  'Ash',
  'Cinder',
  'Flux',
  'Torrent',
  'Cascade',
  'Deluge',
  'Tempest',
  'Nebula',
] as const;

const ENTITIES = [
  'Phantom',
  'Nomad',
  'Walker',
  'Drifter',
  'Runner',
  'Seeker',
  'Mind',
  'Soul',
  'Rover',
  'Hunter',
  'Raider',
  'Weaver',
  'Caster',
  'Dreamer',
  'Oracle',
  'Wraith',
  'Prophet',
  'Sage',
  'Knight',
  'Warden',
  'Sentinel',
  'Scout',
  'Ranger',
  'Stalker',
  'Dancer',
  'Caller',
  'Blade',
  'Arrow',
  'Shield',
  'Rune',
  'Beacon',
  'Star',
  'Comet',
  'Node',
  'Root',
  'Seed',
  'Thread',
  'Pulse',
  'Beat',
  'Chord',
  'Key',
  'Lock',
  'Cipher',
  'Qubit',
  'Specter',
  'Monk',
  'Guard',
  'Voice',
  'Eye',
  'Hand',
  'Fist',
  'Point',
  'Mark',
  'Brand',
  'Signal',
  'Torch',
  'Light',
  'Moon',
  'Void',
  'Zero',
  'Bit',
  'Core',
  'Fiber',
  'Wire',
  'Cell',
  'Spore',
  'Gate',
  'Portal',
  'Lens',
  'Crystal',
  'Nexus',
  'Axis',
  'Vertex',
  'Apex',
  'Zenith',
  'Nadir',
  'Horizon',
  'Meridian',
  'Equinox',
  'Solstice',
] as const;

const M = MODIFIERS.length;
const A = ATMOSPHERE.length;
const E = ENTITIES.length;
const N = M * A * E;

// Mix constant coprime to N so nearby IDs get spread across different (mod, atm, ent) triplets.
const MIX_K = 31;

function modInverse(a: number, n: number): number {
  let t = 0;
  let nextT = 1;
  let r = n;
  let nextR = a;
  while (nextR !== 0) {
    const q = Math.floor(r / nextR);
    [t, nextT] = [nextT, t - q * nextT];
    [r, nextR] = [nextR, r - q * nextR];
  }
  if (r !== 1) return 0;
  return ((t % n) + n) % n;
}

const MIX_K_INV = modInverse(MIX_K, N);

export function getAgentName(agentId: string | number | bigint | null | undefined): string | null {
  if (agentId === null || agentId === undefined) return null;
  const id = Number(agentId);
  if (!Number.isFinite(id)) return null;
  const idNorm = ((id % N) + N) % N;
  const mixed = (idNorm * MIX_K) % N;
  const modIdx = mixed % M;
  const atmIdx = Math.floor(mixed / M) % A;
  const entIdx = Math.floor(mixed / (M * A)) % E;
  const mod = MODIFIERS[modIdx];
  const atm = ATMOSPHERE[atmIdx];
  const ent = ENTITIES[entIdx];
  return `${mod}${atm}${ent}`;
}

export function getAgentIdByName(name: string): number | null {
  for (let modIdx = 0; modIdx < M; modIdx++) {
    const mod = MODIFIERS[modIdx];
    if (!name.startsWith(mod)) continue;
    const rest = name.slice(mod.length);
    for (let atmIdx = 0; atmIdx < A; atmIdx++) {
      const atm = ATMOSPHERE[atmIdx];
      if (!rest.startsWith(atm)) continue;
      const entPart = rest.slice(atm.length);
      const entIdx = ENTITIES.indexOf(entPart as (typeof ENTITIES)[number]);
      if (entIdx === -1) continue;
      const combined = modIdx + atmIdx * M + entIdx * M * A;
      return (((combined * MIX_K_INV) % N) + N) % N;
    }
  }
  return null;
}
