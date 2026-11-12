// The daily run: one world per calendar day, the same for every player.
// The day is the player's local date, so everyone flies the same sky on the
// same date wherever they are.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Today's key, YYYY-MM-DD in local time. */
export function dailyKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The world seed for a day (a string, hashed by Rng). */
export function dailySeed(key: string): string {
  return `gale-daily-${key}`;
}

/** "NOV 11" for "2026-11-11". */
export function dailyLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${MONTHS[(m - 1 + 12) % 12] ?? ""} ${d}`;
}

/** The day of the month, for the button's calendar face. */
export function dailyDay(key: string): number {
  return Number(key.split("-")[2]) || 1;
}

/** Today, as the home screen shows it. */
export interface Today {
  key: string;
  label: string;
  day: number;
  /** Time until the next day's world, "5H 12M" (or "12M" in the last hour). */
  nextIn: string;
}

let today: Today = { key: "", label: "", day: 1, nextIn: "" };
let todayAt = -Infinity;

/**
 * Today's key, label and day number. The HUD asks every frame, so the clock
 * is read at most once a second (timed by performance.now, which costs no
 * Date and leaves Date.now alone) and the strings are rebuilt only when the
 * date changes.
 */
export function dailyToday(): Today {
  const now = performance.now();
  if (now - todayAt >= 1000 || now < todayAt) {
    todayAt = now;
    const date = new Date();
    const key = dailyKey(date);
    if (key !== today.key) today = { key, label: dailyLabel(key), day: dailyDay(key), nextIn: "" };
    // Minutes to local midnight, rounded up (the string changes once a minute).
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const mins = Math.max(1, Math.ceil((midnight.getTime() - date.getTime()) / 60000));
    const nextIn = mins >= 60 ? `${Math.floor(mins / 60)}H ${mins % 60}M` : `${mins}M`;
    if (nextIn !== today.nextIn) today = { ...today, nextIn };
  }
  return today;
}
