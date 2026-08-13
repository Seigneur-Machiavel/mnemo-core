import { loadConfig } from "./config.js";
import { createLLM } from "./llm.js";
import { createServer } from "./api.js";
import { startConsole } from "./console.js";

const config = loadConfig();
const llm    = createLLM(config);
const app    = createServer(llm, config);

const mode = process.argv[2] ?? "both"; // "api" | "console" | "both"

if (mode !== "console") {
  app.listen(config.port, () => {
    console.log(`[mnemo] API running on http://localhost:${config.port}`);
    console.log(`[mnemo] Provider: ${config.provider} | Model: ${config.model}`);
  });
}

if (mode !== "api") {
  startConsole(llm, config);
}
