import fs from "fs/promises";
import path from "path";
import { slotPaths } from "./paths.js";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

export function isImagePath(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

// Vision analysis: descriptive name + text extraction
async function analyzeImage(imagePath, originalName, llm) {
  const raw     = await fs.readFile(imagePath);
  const base64  = raw.toString("base64");
  const ext     = path.extname(originalName).toLowerCase();
  const media   = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";

  const prompt = [
    `You are analyzing an image to produce two things:`,
    `1. A short descriptive filename (snake_case, no extension, max 6 words).`,
    `2. A thorough extraction: reproduce any text, code, diagrams, tables faithfully. Otherwise describe the visual precisely.`,
    ``,
    `Respond ONLY with valid JSON, no markdown:`,
    `{"name":"descriptive_filename","analysis":"full content or description"}`,
  ].join("\n");

  const raw_text = await llm.vision(base64, media, prompt);
  const match = raw_text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in vision response`);

  const parsed = JSON.parse(match[0]);
  const canonicalName = `${parsed.name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}${ext}`;
  return { canonicalName, analysis: parsed.analysis };
}

// Catalogue a file into the slot. Returns CataloguedFile.
// Skips re-analysis if canonical file already exists (dedup).
export async function catalogueFile(filePath, slot, llm) {
  const originalName = path.basename(filePath);
  const isImage = isImagePath(filePath);
  const paths = slotPaths(slot);
  const targetDir = isImage ? paths.images : path.join(paths.base, "files");

  await fs.mkdir(targetDir, { recursive: true });

  let canonicalName = originalName;
  let content = null;

  if (isImage) {
    const tempPath = path.join(targetDir, originalName);

    // Skip if already catalogued under original name (will rename after analysis)
    try {
      const result = await analyzeImage(filePath, originalName, llm);
      canonicalName = result.canonicalName;
      content = result.analysis;

      const canonicalPath = path.join(targetDir, canonicalName);
      // Skip copy+rename if already done
      try { await fs.access(canonicalPath); } catch {
        await fs.copyFile(filePath, canonicalPath);
      }
    } catch (err) {
      console.error(`[mnemo/files] Image analysis failed:`, err);
      // Fallback: store as-is without analysis
      await fs.copyFile(filePath, tempPath).catch(() => {});
    }
  } else {
    const raw = await fs.readFile(filePath, "utf-8");
    content = raw.slice(0, 10000);
  }

  return {
    name: originalName,
    canonicalName,
    localPath: path.join(targetDir, canonicalName),
    type: isImage ? "image" : "text",
    content,
  };
}

// Read a file by absolute path — used when agent requests a ref
export async function readFileContent(absPath) {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

// Apply a search/replace patch to a file
// patch: { path: string, search: string, replace: string }
export async function applyEdit(patch) {
  const original = await fs.readFile(patch.path, "utf-8");
  if (!original.includes(patch.search))
    throw new Error(`[mnemo/edit] Search string not found in ${patch.path}`);
  const updated = original.replace(patch.search, patch.replace);
  await fs.writeFile(patch.path, updated, "utf-8");
  console.log(`[mnemo/edit] Patched: ${patch.path}`);
}
