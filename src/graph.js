import fs from "fs/promises";
import { slotPaths } from "./paths.js";

// { nodes: Record<string, GraphNode>, anchors: Record<string, string> }
// GraphNode: { tags: string[], judgment: string, relations: string[], conclusion: string }

const EMPTY = () => ({ nodes: {}, anchors: {} });

// One cache entry per slot
const cache = {};

export async function loadGraph(slot) {
  if (cache[slot]) return cache[slot];
  try {
    const raw = await fs.readFile(slotPaths(slot).graph, "utf-8");
    cache[slot] = JSON.parse(raw);
    return cache[slot];
  } catch {
    cache[slot] = EMPTY();
    return cache[slot];
  }
}

export async function saveGraph(graph, slot) {
  const paths = slotPaths(slot);
  await fs.mkdir(paths.base, { recursive: true });
  await fs.writeFile(paths.graph, JSON.stringify(graph, null, 2));
  cache[slot] = graph;
}

export async function mergeNodes(incoming, anchors, slot) {
  const graph = await loadGraph(slot);
  for (const [key, node] of Object.entries(incoming)) {
    graph.nodes[key] = node;
    if (anchors[key]) graph.anchors[key] = anchors[key];
  }
  await saveGraph(graph, slot);
}

export function graphToPromptBlock(graph) {
  if (Object.keys(graph.nodes).length === 0) return "";
  const lines = ["[MEMORY GRAPH]"];
  for (const [key, node] of Object.entries(graph.nodes)) {
    lines.push(`${key}: ${node.conclusion}`);
    if (node.relations.length > 0) lines.push(`  links: ${node.relations.join(", ")}`);
    if (graph.anchors[key]) lines.push(`  anchor: ${graph.anchors[key]}`);
  }
  return lines.join("\n");
}

// Invalidate cache entry (e.g. after external edit)
export function invalidateCache(slot) {
  delete cache[slot];
}
