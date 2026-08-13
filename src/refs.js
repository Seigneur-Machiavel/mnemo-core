import fs from "fs/promises";
import path from "path";
import { slotPaths } from "./paths.js";
import { buildProjectTree } from "./files.js";

const EMPTY = () => ({ projectPath: null, activePaths: [], meta: {} });

export async function loadRefs(slot) {
  try {
    const raw = await fs.readFile(slotPaths(slot).refs, "utf-8");
    return JSON.parse(raw);
  } catch {
    return EMPTY();
  }
}

export async function saveRefs(refs, slot) {
  const paths = slotPaths(slot);
  await fs.mkdir(paths.base, { recursive: true });
  await fs.writeFile(paths.refs, JSON.stringify(refs, null, 2));
}

export async function addRef(absPath, slot) {
  const refs = await loadRefs(slot);
  if (!refs.activePaths.includes(absPath)) refs.activePaths.push(absPath);
  await saveRefs(refs, slot);
}

export async function removeRef(absPath, slot) {
  const refs = await loadRefs(slot);
  refs.activePaths = refs.activePaths.filter(p => p !== absPath);
  await saveRefs(refs, slot);
}

export async function buildRefsBlock(slot) {
  const refs = await loadRefs(slot);
  const sections = [];

  // Inject project root + directory tree so the model knows what files exist
  if (refs.projectPath) {
    const tree = await buildProjectTree(refs.projectPath);
    sections.push(
      `[PROJECT ROOT]\n${refs.projectPath}\n\n` +
      `[PROJECT TREE]\n${path.basename(refs.projectPath)}/\n${tree}`
    );
  }

  if (refs.activePaths.length > 0) {
    const lines = ["[ACTIVE REFERENCES]"];
    for (const absPath of refs.activePaths) {
      try {
        const content = await fs.readFile(absPath, "utf-8");
        lines.push(`\n--- ${absPath} ---\n${content}\n--- end ---`);
      } catch {
        lines.push(`\n--- ${absPath} --- [FILE NOT FOUND]`);
      }
    }
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}