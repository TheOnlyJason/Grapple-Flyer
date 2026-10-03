export type CharacterId = "plane" | "monkey" | "nyan";

export interface CharacterDef {
  id: CharacterId;
  name: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: "plane", name: "Paper Plane" },
  { id: "monkey", name: "Monkey" },
  // Display name steers clear of the "Nyan Cat" trademark (App Review 5.2);
  // the internal id stays for save-data compatibility.
  { id: "nyan", name: "Rainbow Cat" },
];

export function isCharacterId(value: unknown): value is CharacterId {
  return CHARACTERS.some((c) => c.id === value);
}

export function cycleCharacterId(current: CharacterId, dir: 1 | -1): CharacterId {
  const i = CHARACTERS.findIndex((c) => c.id === current);
  const next = (i + dir + CHARACTERS.length) % CHARACTERS.length;
  return CHARACTERS[next].id;
}

export function characterName(id: CharacterId): string {
  return CHARACTERS.find((c) => c.id === id)?.name ?? id;
}
