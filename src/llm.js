// LLM provider abstraction.
// All providers expose the same interface:
//   llm.complete(messages, opts?) -> Promise<string>
//   llm.vision(base64, mediaType, prompt) -> Promise<string>
//   llm.stream(messages, opts?, onChunk) -> Promise<string>
//
// Supported providers (set via config):
//   openai-compat  ->  LM Studio, Ollama, OpenAI (same /v1/chat/completions format)
//   anthropic      ->  Anthropic API (different auth + message format)

// --- OpenAI-compatible provider ---

function openaiCompat(baseUrl, model, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  async function post(body) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, ...body }),
    });
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
    return res;
  }

  async function complete(messages, opts = {}) {
    const res  = await post({ messages, temperature: 0.1, max_tokens: 1000, ...opts });
    const data = await res.json();
    return data.choices[0].message.content?.trim() ?? "";
  }

  async function vision(base64, mediaType, prompt) {
    const res = await post({
      temperature: 0.1,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
          { type: "text", text: prompt },
        ],
      }],
    });
    const data = await res.json();
    return data.choices[0].message.content?.trim() ?? "";
  }

  // Streams chunks via onChunk(text), returns full reply
  async function stream(messages, opts = {}, onChunk) {
    const res = await post({ messages, stream: true, stream_options: { include_usage: true }, ...opts });
    if (!res.body) throw new Error("No response body");

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply  = "";
    let usage  = null;

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break outer;

        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        if (chunk.usage) usage = chunk.usage;
        const content = chunk.choices?.[0]?.delta?.content;
        if (!content) continue;

        reply += content;
        onChunk?.(content);
      }
    }

    return { reply: reply.trim(), usage };
  }

  return { complete, vision, stream };
}

// --- Anthropic provider ---

function anthropic(model, apiKey) {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  // Anthropic separates system from messages
  function splitMessages(messages) {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const rest   = messages.filter(m => m.role !== "system");
    return { system, rest };
  }

  async function complete(messages, opts = {}) {
    const { system, rest } = splitMessages(messages);
    const body = { model, max_tokens: 1000, messages: rest, ...opts };
    if (system) body.system = system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content[0]?.text?.trim() ?? "";
  }

  async function vision(base64, mediaType, prompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic vision error ${res.status}`);
    const data = await res.json();
    return data.content[0]?.text?.trim() ?? "";
  }

  async function stream(messages, opts = {}, onChunk) {
    const { system, rest } = splitMessages(messages);
    const body = { model, max_tokens: 1000, stream: true, messages: rest, ...opts };
    if (system) body.system = system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic stream error ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply  = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break outer;

        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        const text = chunk.delta?.text;
        if (!text) continue;
        reply += text;
        onChunk?.(text);
      }
    }

    return { reply: reply.trim(), usage: null };
  }

  return { complete, vision, stream };
}

// --- Factory ---

export function createLLM(config) {
  if (config.provider === "anthropic")
    return anthropic(config.model, config.apiKey);

  // Default: openai-compat (LM Studio, Ollama, OpenAI)
  return openaiCompat(
    config.baseUrl ?? "http://localhost:1234/v1",
    config.model,
    config.apiKey ?? null
  );
}
