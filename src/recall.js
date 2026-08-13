import { loadExchange } from "./archive.js";
import { loadGraph } from "./graph.js";

const RECALL_RE = /<RECALL\s+anchor="([^"]+)"\s*\/>/g;

export async function resolveRecalls(text, slot) {
  const matches = [...text.matchAll(RECALL_RE)];
  if (matches.length === 0) return text;

  const graph = await loadGraph(slot);
  let result = text;

  for (const match of matches) {
    const nodeKey = match[1];
    const exchangeId = graph.anchors[nodeKey];
    if (!exchangeId) {
      result = result.replace(match[0], `[RECALL: no anchor for "${nodeKey}"]`);
      continue;
    }
    const entry = await loadExchange(exchangeId, slot);
    if (!entry) {
      result = result.replace(match[0], `[RECALL: archive missing for "${exchangeId}"]`);
      continue;
    }
    const rawText = entry.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    result = result.replace(match[0], `[RECALLED from ${exchangeId}]\n${rawText}\n[/RECALLED]`);
  }

  return result;
}
