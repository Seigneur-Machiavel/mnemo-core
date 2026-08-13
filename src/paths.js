import path from "path";

const DATA_ROOT = path.resolve("conversations");

export const DEFAULT_SLOT = "default";

export function slotPaths(slot) {
  const base = path.join(DATA_ROOT, slot);
  return {
    base,
    graph:   path.join(base, "graph.json"),
    seen:    path.join(base, "seen.json"),
    refs:    path.join(base, "refs.json"),   // active file references + slot meta
    archive: path.join(base, "archive"),
    images:  path.join(base, "images"),
  };
}
