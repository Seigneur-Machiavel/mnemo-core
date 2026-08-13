import fs from "fs/promises";
import path from "path";
import { slotPaths } from "./paths.js";

export async function saveExchange(id, messages, slot) {
  const dir = slotPaths(slot).archive;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, messages }, null, 2));
}

export async function loadExchange(id, slot) {
  try {
    const raw = await fs.readFile(path.join(slotPaths(slot).archive, `${id}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listExchangeIds(slot) {
  try {
    const files = await fs.readdir(slotPaths(slot).archive);
    return files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
  } catch {
    return [];
  }
}

// Returns the last `n` exchanges as flat { role, content } pairs, sorted by filename (timestamp order).
export async function loadRecentExchanges(slot, n = 6) {
  const ids = await listExchangeIds(slot);
  // exchange_<timestamp>.json — lexicographic sort = chronological
  ids.sort();
  const recent = ids.slice(-n);
  const messages = [];
  for (const id of recent) {
    const ex = await loadExchange(id, slot);
    if (!ex?.messages) continue;
    for (const m of ex.messages) messages.push({ role: m.role, content: m.content });
  }
  return messages;
}