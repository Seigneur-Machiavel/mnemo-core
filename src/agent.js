import { loadGraph, graphToPromptBlock, mergeNodes } from "./graph.js";
import { saveExchange } from "./archive.js";
import { distillExchange } from "./distill.js";
import { resolveRecalls } from "./recall.js";
import { isSeen, markSeen, pairKey } from "./seen.js";
import { applyEdit } from "./files.js";
import { loadRefs, addRef, removeRef, buildRefsBlock } from "./refs.js";

const RECENT_MESSAGES = 6;
const MAX_CYCLES      = 8;

const ADD_REF_RE    = /<ADD_REF\s+path="([^"]+)"\s*\/>/g;
const REMOVE_REF_RE = /<REMOVE_REF\s+path="([^"]+)"\s*\/>/g;
const RECALL_RE     = /<RECALL\s+anchor="([^"]+)"\s*\/>/g;
const EDIT_RE       = /<EDIT\s+path="([^"]+)">([\s\S]*?)<\/EDIT>/g;
const STOP_RE       = /<STOP\s+status="([^"]+)"\s*\/>/;

const SYSTEM_PROMPT = `You are an AI agent with persistent memory and file access.

## Memory
A compressed semantic graph of past exchanges is injected below as [MEMORY GRAPH].
Use it as silent background knowledge. Never mention the memory system unless asked.

## Project & Active References
If a [PROJECT ROOT] and [PROJECT TREE] are injected below, you know the project path and its file structure.
Files loaded into context appear as [ACTIVE REFERENCES] — read them directly, no need to ADD_REF again.

## Actions
You may emit these tags anywhere in your response. They are processed after your reply.

Add a file to context (content visible next turn):
<ADD_REF path="/absolute/path/to/file" />

Remove a file from context when no longer needed:
<REMOVE_REF path="/absolute/path/to/file" />

Edit an existing file — SEARCH must be a verbatim excerpt from the file (whitespace and indentation included):
<EDIT path="/absolute/path/to/file">
<<<SEARCH>>>
exact content to find
<<<REPLACE>>>
new content
</EDIT>

Create a NEW file that does not exist yet (SEARCH must be empty):
<EDIT path="/absolute/path/to/new_file.js">
<<<SEARCH>>>
<<<REPLACE>>>
full file content here
</EDIT>

Recall a full past exchange by anchor key:
<RECALL anchor="node_key" />

Signal completion (done or stuck — include a brief reason in your reply):
<STOP status="done" />
<STOP status="stuck" />

## Rules
- STOP when your task is complete or you cannot proceed.
- To edit an existing file: ADD_REF it first (if not already in [ACTIVE REFERENCES]), wait for the next turn to read its content, then emit EDIT with an exact SEARCH string copied from the file. Never guess or reconstruct file content.
- Empty SEARCH = CREATE mode. Only use it for files that do not exist yet. Using empty SEARCH on an existing file will overwrite it entirely and destroy its content.
- Multiple edits = multiple EDIT tags, one per logical change.
- REMOVE_REF drops a file from context only — it does not delete it from disk.
- Never emit raw escape sequences like \\n in file content — write actual newlines.`;

function buildMessages(graphBlock, refsBlock, history) {
  const systemParts = [SYSTEM_PROMPT];
  if (graphBlock) systemParts.push(graphBlock);
  if (refsBlock)  systemParts.push(refsBlock);

  return [
    { role: "system", content: systemParts.join("\n\n---\n\n") },
    ...history.slice(-RECENT_MESSAGES),
  ];
}

async function applyTags(reply, slot, onStatus) {
  const actions = [];

  for (const m of reply.matchAll(ADD_REF_RE)) {
    await addRef(m[1], slot);
    actions.push(`ADD_REF: ${m[1]}`);
  }

  for (const m of reply.matchAll(REMOVE_REF_RE)) {
    await removeRef(m[1], slot);
    actions.push(`REMOVE_REF: ${m[1]}`);
  }

  for (const m of reply.matchAll(EDIT_RE)) {
    const filePath = m[1];
    const body     = m[2];
    const sepIdx   = body.indexOf("<<<REPLACE>>>");
    if (sepIdx === -1) {
      console.warn(`[mnemo/agent] EDIT missing <<<REPLACE>>> for ${filePath}`);
      continue;
    }
    const searchRaw = body.slice(body.indexOf("<<<SEARCH>>>") + 12, sepIdx);
    const search    = searchRaw.trim();  // empty string = CREATE mode
    const replace   = body.slice(sepIdx + 13).trim();
    try {
      await applyEdit({ path: filePath, search, replace });
      actions.push(`EDIT: ${filePath}`);
    } catch (err) {
      onStatus?.(`⚠️ Edit failed on ${filePath}: ${err.message}`);
    }
  }

  const stopMatch  = reply.match(STOP_RE);
  return { actions, stopped: !!stopMatch, stopStatus: stopMatch?.[1] ?? null };
}

function cleanReply(reply) {
  return reply
    .replace(ADD_REF_RE, "")
    .replace(REMOVE_REF_RE, "")
    .replace(EDIT_RE, "")
    .replace(STOP_RE, "")
    .replace(RECALL_RE, "")
    .trim();
}

// history: [{ role, content }] — shared across console and API, managed by caller
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

    // Distill async — never blocks the response
    archiveAndDistill(userMessage, clean, slot, llm)
      .catch(err => console.error("[mnemo/agent] distill failed:", err));

    if (stopped) { onStatus?.(`Agent stopped (${stopStatus})`); break; }
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
