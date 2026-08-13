import { loadGraph, graphToPromptBlock, mergeNodes } from "./graph.js";
import { saveExchange } from "./archive.js";
import { distillExchange } from "./distill.js";
import { resolveRecalls } from "./recall.js";
import { isSeen, markSeen, pairKey } from "./seen.js";
import { applyEdit } from "./files.js";
import { loadRefs, addRef, removeRef, buildRefsBlock } from "./refs.js";

const RECENT_MESSAGES = 6;
const MAX_CYCLES      = 8; // safety ceiling for autonomous loops

// Tags the model can emit
const ADD_REF_RE    = /<ADD_REF\s+path="([^"]+)"\s*\/>/g;
const REMOVE_REF_RE = /<REMOVE_REF\s+path="([^"]+)"\s*\/>/g;
const RECALL_RE     = /<RECALL\s+anchor="([^"]+)"\s*\/>/g;
const EDIT_RE       = /<EDIT\s+path="([^"]+)">([\s\S]*?)<\/EDIT>/g;
const STOP_RE       = /<STOP\s+status="([^"]+)"\s*\/>/;

const SYSTEM_PROMPT = `You are an AI agent with persistent memory and file access.

## Memory
A compressed semantic graph of past exchanges is injected below as [MEMORY GRAPH].
Use it as silent background knowledge. Never mention the memory system unless asked.

## Active References
Files currently in context appear below as [ACTIVE REFERENCES].
Their content is already available — read them directly.

## Actions
You may emit these tags anywhere in your response. They are processed after your reply.

Add a file to context (you will see its content next turn):
<ADD_REF path="/absolute/path/to/file" />

Remove a file from context when no longer needed:
<REMOVE_REF path="/absolute/path/to/file" />

Edit a file (search/replace — be exact, whitespace included):
<EDIT path="/absolute/path/to/file">
<<<SEARCH>>>
exact content to find
<<<REPLACE>>>
new content
</EDIT>

Recall a full past exchange by anchor key:
<RECALL anchor="node_key" />

Signal completion (done or stuck — include a brief reason in your reply):
<STOP status="done" />
<STOP status="stuck" />

## Rules
- Emit <STOP /> when your task is complete or you cannot proceed.
- Never fabricate file content — use ADD_REF to read first.
- One EDIT per block. Multiple edits = multiple EDIT tags.
- The search string in EDIT must match the file exactly (whitespace, indentation included).
- Prefer surgical edits over full rewrites.
- Removing a ref doesn't delete the file, it just drops it from context.`;

function buildMessages(graphBlock, refsBlock, history) {
  const systemParts = [SYSTEM_PROMPT];
  if (graphBlock) systemParts.push(graphBlock);
  if (refsBlock)  systemParts.push(refsBlock);

  const system   = systemParts.join("\n\n---\n\n");
  const recent   = history.slice(-RECENT_MESSAGES);
  return [{ role: "system", content: system }, ...recent];
}

async function applyTags(reply, slot, onStatus) {
  const actions = [];

  // ADD_REF
  for (const m of reply.matchAll(ADD_REF_RE)) {
    await addRef(m[1], slot);
    actions.push(`ADD_REF: ${m[1]}`);
  }

  // REMOVE_REF
  for (const m of reply.matchAll(REMOVE_REF_RE)) {
    await removeRef(m[1], slot);
    actions.push(`REMOVE_REF: ${m[1]}`);
  }

  // EDIT (search/replace)
  for (const m of reply.matchAll(EDIT_RE)) {
    const filePath = m[1];
    const body     = m[2];
    const sepIdx   = body.indexOf("<<<REPLACE>>>");
    if (sepIdx === -1) {
      console.warn(`[mnemo/agent] EDIT tag missing <<<REPLACE>>> for ${filePath}`);
      continue;
    }
    const search  = body.slice(body.indexOf("<<<SEARCH>>>") + 12, sepIdx).trim();
    const replace = body.slice(sepIdx + 13).trim();
    try {
      await applyEdit({ path: filePath, search, replace });
      actions.push(`EDIT: ${filePath}`);
    } catch (err) {
      onStatus?.(`⚠️ Edit failed on ${filePath}: ${err.message}`);
    }
  }

  const stopMatch = reply.match(STOP_RE);
  const stopped   = !!stopMatch;
  const stopStatus = stopMatch?.[1] ?? null;

  return { actions, stopped, stopStatus };
}

// Strips action tags from text shown to user
function cleanReply(reply) {
  return reply
    .replace(ADD_REF_RE, "")
    .replace(REMOVE_REF_RE, "")
    .replace(EDIT_RE, "")
    .replace(STOP_RE, "")
    .replace(RECALL_RE, "")
    .trim();
}

// Main entry point.
// history: [{ role, content }]  (plain messages, no system)
// onChunk(text): stream callback
// onStatus(text): side-channel for system events (ref changes, edits...)
export async function runAgent(userMessage, history, slot, llm, { onChunk, onStatus } = {}) {
  history = [...history, { role: "user", content: userMessage }];
  let cycles = 0;

  while (cycles < MAX_CYCLES) {
    cycles++;

    const graph      = await loadGraph(slot);
    const graphBlock = graphToPromptBlock(graph);
    const refsBlock  = await buildRefsBlock(slot);
    const messages   = buildMessages(graphBlock, refsBlock, history);

    onStatus?.(`[cycle ${cycles}] Thinking...`);

    const { reply } = await llm.stream(messages, {}, onChunk);
    const resolved  = await resolveRecalls(reply, slot);
    const clean     = cleanReply(resolved);

    history.push({ role: "assistant", content: clean });

    const { actions, stopped, stopStatus } = await applyTags(reply, slot, onStatus);

    for (const a of actions) onStatus?.(a);

    // Distill asynchronously — don't block the response
    archiveAndDistill(userMessage, clean, slot, llm).catch(
      err => console.error("[mnemo/agent] distill failed:", err)
    );

    if (stopped) {
      onStatus?.(`Agent stopped (${stopStatus})`);
      break;
    }

    // If no actions were taken and no stop, the agent is done naturally
    if (actions.length === 0) break;
  }

  if (cycles >= MAX_CYCLES) onStatus?.(`⚠️ Max cycles (${MAX_CYCLES}) reached.`);

  return history;
}

async function archiveAndDistill(userText, reply, slot, llm) {
  if (!userText) return;
  const key = pairKey(userText, reply);
  if (await isSeen(key, slot)) return;

  const id = `exchange_${Date.now()}`;
  await saveExchange(id, [
    { role: "user",      content: userText, timestamp: Date.now() },
    { role: "assistant", content: reply,    timestamp: Date.now() },
  ], slot);

  const { nodes, anchors } = await distillExchange(id, userText, reply, llm);
  await mergeNodes(nodes, anchors, slot);
  await markSeen(key, slot);
}
