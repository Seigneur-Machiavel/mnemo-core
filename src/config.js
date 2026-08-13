import fs from "fs";
import path from "path";

const DEFAULTS = {
  provider:     "openai-compat",
  baseUrl:      "http://localhost:1234/v1",
  model:        "google/gemma-4-e4b",
  apiKey:       null,
  maxContext:   131072,
  port:         3333,
  defaultSlot:  "default",
  systemPrompt: "",           // user-defined extra instructions
};

export function loadConfig() {
  let file = {};
  const cfgPath = path.resolve("config.json");
  if (fs.existsSync(cfgPath)) {
    try { file = JSON.parse(fs.readFileSync(cfgPath, "utf-8")); }
    catch { console.warn("[mnemo] config.json parse failed, using defaults"); }
  }

  return {
    provider:     process.env.MNEMO_PROVIDER      ?? file.provider     ?? DEFAULTS.provider,
    baseUrl:      process.env.MNEMO_BASE_URL       ?? file.baseUrl      ?? DEFAULTS.baseUrl,
    model:        process.env.MNEMO_MODEL          ?? file.model        ?? DEFAULTS.model,
    apiKey:       process.env.MNEMO_API_KEY        ?? file.apiKey       ?? DEFAULTS.apiKey,
    maxContext:   process.env.MNEMO_MAX_CONTEXT    ?? file.maxContext   ?? DEFAULTS.maxContext,
    port:         process.env.MNEMO_PORT           ?? file.port         ?? DEFAULTS.port,
    defaultSlot:  process.env.MNEMO_SLOT           ?? file.defaultSlot  ?? DEFAULTS.defaultSlot,
    systemPrompt: process.env.MNEMO_SYSTEM_PROMPT  ?? file.systemPrompt ?? DEFAULTS.systemPrompt,
  };
}