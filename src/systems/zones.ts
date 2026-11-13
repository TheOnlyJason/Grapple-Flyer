// Zones: every CONFIG.zones.lengthM of a run the scenery and the weather
// change and the sky gains a twist. Zone 1 is the sky as it always was;
// after the storm the last three go round again, each pass a little stronger.
// Twists change only what appears in the sky, never the swing.

import { CONFIG } from "../core/config";

export type ZoneId = "dusk" | "rain" | "snow" | "storm";

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** What is new in it, in a few words (the banner's second line). */
  twist: string;
}

export const ZONES: readonly ZoneDef[] = [
  { id: "dusk", name: "DUSK PEAKS", twist: "" },
  { id: "rain", name: "RAIN", twist: "ROCKS DRIFT" },
  { id: "snow", name: "SNOW", twist: "ANCHORS CRUMBLE" },
  { id: "storm", name: "STORM", twist: "LIGHTNING STRIKES" },
];

export interface Zone {
  /** 0 for the first zone, 1 for the second, ... (it keeps counting through the loops). */
  index: number;
  def: ZoneDef;
  /** Passes through rain, snow and storm before this one (0 the first time). */
  loop: number;
  /** How far into the zone, 0..1 over its first blendM. */
  blend: number;
  /** Metres into the zone. */
  into: number;
}

/** The zone at `metres` into a run. */
export function zoneAt(metres: number): Zone {
  const Z = CONFIG.zones;
  const m = Math.max(0, metres);
  const index = Math.floor(m / Z.lengthM);
  const into = m - index * Z.lengthM;
  if (index === 0) return { index, def: ZONES[0], loop: 0, blend: 1, into };
  const k = index - 1;
  return { index, def: ZONES[1 + (k % 3)], loop: Math.floor(k / 3), blend: Math.min(1, into / Z.blendM), into };
}

/** A twist's chance in a zone: stronger on each loop, never certain. */
export function twistChance(base: number, zone: Zone): number {
  return Math.min(0.9, base * (1 + CONFIG.zones.loopBoost * zone.loop));
}

/**
 * What the screen shows at `metres`: around each seam the last zone's look
 * cross-fades into the next one's over CONFIG.zones.blendM, centred on the
 * seam (so the new sky is half there when its banner shows). `from` and `to`
 * are the same away from a seam. Drawing only: the twists still begin exactly
 * at the seam, and nothing here touches the world.
 */
export interface ZoneLook {
  from: ZoneId;
  to: ZoneId;
  /** 0 all `from` .. 1 all `to`, eased. */
  k: number;
  /** Metres into the `to` zone (negative just before its seam). */
  into: number;
}

function defAt(index: number): ZoneDef {
  return index <= 0 ? ZONES[0] : ZONES[1 + ((index - 1) % 3)];
}

export function zoneLook(metres: number): ZoneLook {
  const Z = CONFIG.zones;
  const m = Math.max(0, metres);
  const half = Z.blendM / 2;
  const index = Math.floor((m + half) / Z.lengthM);
  const into = m - index * Z.lengthM;
  const t = Math.min(1, Math.max(0, (into + half) / Z.blendM));
  return { from: defAt(index - 1).id, to: defAt(index).id, k: t * t * (3 - 2 * t), into };
}

/** How much of zone `id`'s look a ZoneLook carries (0..1). */
export function lookWeight(look: ZoneLook | null, id: ZoneId): number {
  if (!look) return 0;
  return (look.to === id ? look.k : 0) + (look.from === id ? 1 - look.k : 0);
}
