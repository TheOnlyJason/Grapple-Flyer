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
  /** How far into the zone, 0..1 over its first blendM (its weather eases in). */
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
