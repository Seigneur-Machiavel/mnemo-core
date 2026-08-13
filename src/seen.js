import fs from "fs/promises";
import { slotPaths } from "./paths.js";

const caches = {};

async function load(slot) {
  if (caches[slot]) return caches[slot];
  try {
    const raw = await fs.readFile(slotPaths(slot).seen, "utf-8");
    caches[slot] = new Set(JSON.parse(raw));
    return caches[slot];
  } catch {
    caches[slot] = new Set();
    return caches[slot];
  }
}

async function persist(seen, slot) {
  const paths = slotPaths(slot);
  await fs.mkdir(paths.base, { recursive: true });
  await fs.writeFile(paths.seen, JSON.stringify([...seen], null, 2));
}

export function pairKey(user, assistant) {
  return `${user.slice(0, 80)}|||${assistant.slice(0, 80)}`;
}

export async function isSeen(key, slot) {
  return (await load(slot)).has(key);
}

export async function markSeen(key, slot) {
  const seen = await load(slot);
  seen.add(key);
  await persist(seen, slot);
}
