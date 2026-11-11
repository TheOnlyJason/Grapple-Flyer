// Trails: coloured streamers bought with orbs on the home screen's TRAILS
// picker. Any trail can be worn by any character; "own" is each character's
// own trail (the plane's white streak, the Monkey King's golden cloud, the
// cat's rainbow) and is always owned.

export type TrailId = "own" | "coral" | "lilac" | "rose" | "sunset" | "ocean" | "aurora";

export interface TrailDef {
  id: TrailId;
  name: string;
  /** Orbs to unlock (0 = free). */
  price: number;
  /** Ribbon bands, top to bottom; empty for "own". */
  colors: readonly string[];
}

// Flat, soft colours in the game's palette, kept clear of the hues that mean
// something in play: the anchors' cyan, the gold window and orbs, the mint
// wisps. Prices are tuned against the orb take of an ordinary run (about
// 5-7 orbs for a player not chasing them, two or three times that for one
// who is), so the first unlock comes within an evening and the last one is a
// long-term goal.
export const TRAILS: readonly TrailDef[] = [
  { id: "own", name: "Signature", price: 0, colors: [] },
  { id: "coral", name: "Coral", price: 60, colors: ["#ff8a80"] },
  { id: "lilac", name: "Lilac", price: 120, colors: ["#b8a4ff"] },
  { id: "rose", name: "Rose", price: 200, colors: ["#ff8fc8"] },
  { id: "sunset", name: "Sunset", price: 320, colors: ["#ffb36b", "#ff6f91"] },
  { id: "ocean", name: "Ocean", price: 500, colors: ["#5fc4ff", "#8a8cff"] },
  { id: "aurora", name: "Aurora", price: 800, colors: ["#7affc1", "#6fd0ff", "#c58bff"] },
];

export function isTrailId(value: unknown): value is TrailId {
  return TRAILS.some((t) => t.id === value);
}

export function trailDef(id: TrailId): TrailDef {
  return TRAILS.find((t) => t.id === id) ?? TRAILS[0];
}

/** The save's key for an owned shop item. */
export function trailItem(id: TrailId): string {
  return `trail:${id}`;
}
