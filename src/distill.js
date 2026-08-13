const MAX_INPUT_CHARS = 3000;

const SYSTEM = `You are a memory compression engine.
Extract the key concepts from this conversation exchange as a JSON object.

STRICT RULES:
- Output ONLY valid JSON. Start with { and end with }.
- No markdown, no backticks, no preamble, no trailing text.
- Maximum 4 nodes. Focus on decisions, goals, constraints, context, conclusions.
- Preserve specific entities (names, dates, values, code snippets) verbatim. Do not over-generalize.
- snake_case keys, max 30 chars. One sentence per field. Skip pleasantries.
- Field values must never contain raw quotes — rephrase if needed.

Schema:
{"nodes":{"concept_key":{"tags":["context"],"judgment":"one sentence with specific details","relations":[],"conclusion":"one sentence"}}}

Valid tags: "decision" | "goal" | "constraint" | "context" | "conclusion" | "resource"`;

function parseDistillJSON(raw) {
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in distill response: ${raw.slice(0, 100)}`);

  let json = match[0];
  try {
    return JSON.parse(json);
  } catch {
    // Attempt light repair: strip trailing incomplete entry and close braces
    json = json.replace(/,\s*$/, "").replace(/,\s*"[^"]*"\s*:\s*[^,}]*$/, "");
    const open = (json.match(/\{/g) ?? []).length - (json.match(/\}/g) ?? []).length;
    json += "}".repeat(Math.max(0, open));
    return JSON.parse(json);
  }
}

export async function distillExchange(exchangeId, userMessage, assistantMessage, llm) {
  const user      = userMessage.slice(0, MAX_INPUT_CHARS);
  const assistant = assistantMessage.slice(0, MAX_INPUT_CHARS);

  const raw = await llm.complete([
    { role: "system", content: SYSTEM },
    { role: "user",   content: `USER: ${user}\n\nASSISTANT: ${assistant}` }
  ], { temperature: 0.1, max_tokens: 512 });

  const parsed = parseDistillJSON(raw);

  const anchors = {};
  for (const key of Object.keys(parsed.nodes)) anchors[key] = exchangeId;

  return { nodes: parsed.nodes, anchors };
}
