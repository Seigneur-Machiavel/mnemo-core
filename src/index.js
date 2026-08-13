import { loadConfig } from "./config.js";
import { createLLM } from "./llm.js";
import { createServer } from "./api.js";
import { startConsole } from "./console.js";

const config = loadConfig();
let llm      = createLLM(config);

// Rebuilds the llm instance when config changes via PATCH /config
async function onConfigChange(newConfig) {
  llm = createLLM(newConfig);
  console.log(`[mnemo] Config updated — provider: ${newConfig.provider} | model: ${newConfig.model}`);
}

const app  = createServer(llm, config, onConfigChange);
const mode = process.argv[2] ?? "both"; // "api" | "console" | "both"

if (mode !== "console") {
  app.listen(config.port, () => {
    console.log(`[mnemo] API on http://localhost:${config.port}`);
  });
}

async function checkLLM() {
  try {
    await llm.complete([{ role: "user", content: "ping" }], { max_tokens: 1 });
    console.log(`[mnemo] ✅ ${config.provider} reachable — model: ${config.model}`);
  } catch {
    console.warn(`[mnemo] ⚠️  LLM unreachable (${config.baseUrl ?? "anthropic"}) — start your provider first.`);
  }
}

await checkLLM();

if (mode !== "api") startConsole(llm, config);
