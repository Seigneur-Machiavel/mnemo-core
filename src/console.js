import readline from "readline";
import { runAgent } from "./agent.js";
import { getHistory } from "./api.js";

export async function startConsole(llm, config) {
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => rl.question("\nYou > ", handleInput);

  let slot = config.defaultSlot;

  console.log(`\n🧠 Mnemo — slot: ${slot} | model: ${config.model}`);
  console.log(`Commands: /slot <name>  /clear  /refs  /exit\n`);

  async function handleInput(input) {
    input = input.trim();
    if (!input) return ask();

    if (input === "/exit") return rl.close();

    if (input.startsWith("/slot ")) {
      slot = input.slice(6).trim();
      console.log(`Switched to slot: ${slot}`);
      return ask();
    }

    if (input === "/clear") {
      getHistory(slot).length = 0; // mutate in place — API sees the same reset
      console.log("History cleared.");
      return ask();
    }

    if (input === "/refs") {
      const { loadRefs } = await import("./refs.js");
      const refs = await loadRefs(slot);
      console.log("Active refs:", refs.activePaths.length ? refs.activePaths.join("\n  ") : "(none)");
      console.log("Project path:", refs.projectPath ?? "(none)");
      return ask();
    }

    process.stdout.write("\nAgent > ");

    try {
      const updated = await runAgent(input, getHistory(slot), slot, llm, {
        onChunk:  text => process.stdout.write(text),
        onStatus: text => console.log(`\n  [${text}]`),
      });
      // Write back to shared store
      getHistory(slot).length = 0;
      getHistory(slot).push(...updated);
    } catch (err) {
      console.error("\n[error]", err.stack);
    }

    process.stdout.write("\n");
    ask();
  }

  ask();
}
