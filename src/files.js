import fs from "fs/promises";
import path from "path";

export function isImagePath(filePath) {
  return new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"])
    .has(path.extname(filePath).toLowerCase());
}

export async function readFileContent(absPath) {
  try { return await fs.readFile(absPath, "utf-8"); }
  catch { return null; }
}

export async function applyEdit(patch) {
  await fs.mkdir(path.dirname(patch.path), { recursive: true });

  if (!patch.search) {
    await fs.writeFile(patch.path, patch.replace, "utf-8");
    console.log(`[mnemo/edit] Created: ${patch.path}`);
    return;
  }

  const original = await fs.readFile(patch.path, "utf-8");
  if (!original.includes(patch.search))
    throw new Error(`Search string not found in ${patch.path}`);
  await fs.writeFile(patch.path, original.replace(patch.search, patch.replace), "utf-8");
  console.log(`[mnemo/edit] Patched: ${patch.path}`);
}

const IGNORE = new Set([
  "node_modules", ".git", ".svn", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".venv", "venv", ".DS_Store", "coverage", ".turbo",
]);

const MAX_DEPTH   = 4;
const MAX_ENTRIES = 300;

export async function buildProjectTree(rootPath, depth = 0, counter = { n: 0 }) {
  if (depth > MAX_DEPTH || counter.n >= MAX_ENTRIES) return "";

  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return "";
  }

  const filtered = entries
    .filter(e => !IGNORE.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const lines = [];
  for (let i = 0; i < filtered.length; i++) {
    if (counter.n >= MAX_ENTRIES) { lines.push("  … (truncated)"); break; }
    counter.n++;
    const entry  = filtered[i];
    const isLast = i === filtered.length - 1;
    const prefix = "  ".repeat(depth) + (isLast ? "└── " : "├── ");
    lines.push(prefix + entry.name + (entry.isDirectory() ? "/" : ""));
    if (entry.isDirectory()) {
      const sub = await buildProjectTree(path.join(rootPath, entry.name), depth + 1, counter);
      if (sub) lines.push(sub);
    }
  }

  return lines.join("\n");
}

export async function analyzeImage(base64, mediaType, originalName, llm) {
  const prompt = [
    `You are analyzing an image to produce two things:`,
    `1. A short descriptive label (snake_case, max 6 words, no extension).`,
    `2. A thorough extraction: reproduce any text, code, diagrams, tables faithfully. Otherwise describe the visual precisely.`,
    ``,
    `Respond ONLY with valid JSON, no markdown:`,
    `{"label":"descriptive_label","analysis":"full content or description"}`,
  ].join("\n");

  const raw  = await llm.vision(base64, mediaType, prompt);
  const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim().match(/\{[\s\S]*\}/);
  if (!json) throw new Error(`No JSON in vision response`);

  const parsed = JSON.parse(json[0]);
  return {
    label:    parsed.label.replace(/[^a-z0-9_-]/gi, "_").toLowerCase(),
    analysis: parsed.analysis,
  };
}