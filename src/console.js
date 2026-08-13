import readline from "readline";
import { runAgent } from "./agent.js";

export async function startConsole(llm, config) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question("\nYou > ", handleInput);

  let history = [];
  let slot = config.defaultSlot;

  console.log(`\n🧠 Mnemo — slot: ${slot} | model: ${config.model}`);
  console.log(`Commands: /slot <name>  /clear  /refs  /exit\n`);

  async function handleInput(input) {
    input = input.trim();
    if (!input) return prompt();

    // Built-in commands
    if (input === "/exit") { rl.close(); return; }

    if (input.startsWith("/slot ")) {
      slot = input.slice(6).trim();
      history = [];
      console.log(`Switched to slot: ${slot}`);
      return prompt();
    }

    if (input === "/clear") {
      history = [];
      console.log("History cleared.");
      return prompt();
    }

    if (input === "/refs") {
      const { loadRefs } = await import("./refs.js");
      const refs = await loadRefs(slot);
      console.log("Active refs:", refs.activePaths.length ? refs.activePaths.join("\n  ") : "(none)");
      console.log("Project path:", refs.projectPath ?? "(none)");
      return prompt();
    }

    process.stdout.write("\nAgent > ");

    try {
      history = await runAgent(input, history, slot, llm, {
        onChunk:  text => process.stdout.write(text),
        onStatus: text => console.log(`\n  [${text}]`),
      });
    } catch (err) {
      console.error("\n[error]", err.message);
    }

    process.stdout.write("\n");
    prompt();
  }

  prompt();
}
