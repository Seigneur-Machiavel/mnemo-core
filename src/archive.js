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
