import fs from "fs/promises";
import path from "path";

export function isImagePath(filePath) {
  return new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"])
    .has(path.extname(filePath).toLowerCase());
}

// Read a file by absolute path
export async function readFileContent(absPath) {
  try { return await fs.readFile(absPath, "utf-8"); }
  catch { return null; }
}

// Apply a search/replace patch to a file.
// Empty search = CREATE mode (writes replace as full content, creates dirs as needed).
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

// Analyse an image (base64) and return a label + text description.
// Does NOT store the file — caller decides what to do with the result.
export async function analyzeImage(base64, mediaType, originalName, llm) {
  const prompt = [
    `You are analyzing an image to produce two things:`,
    `1. A short descriptive label (snake_case, max 6 words, no extension).`,
    `2. A thorough extraction: reproduce any text, code, diagrams, tables faithfully. Otherwise describe the visual precisely.`,
    ``,
    `Respond ONLY with valid JSON, no markdown:`,
    `{"label":"descriptive_label","analysis":"full content or description"}`,
  ].join("\n");

  const ext  = path.extname(originalName).toLowerCase();
  const raw  = await llm.vision(base64, mediaType, prompt);
  const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim().match(/\{[\s\S]*\}/);
  if (!json) throw new Error(`No JSON in vision response`);

  const parsed = JSON.parse(json[0]);
  return {
    label:    parsed.label.replace(/[^a-z0-9_-]/gi, "_").toLowerCase(),
    analysis: parsed.analysis,
  };
}
