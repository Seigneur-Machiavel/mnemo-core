import express from "express";
import { runAgent } from "./agent.js";
import { loadRefs, saveRefs, addRef, removeRef } from "./refs.js";
import { loadGraph, invalidateCache } from "./graph.js";
import { listExchangeIds, loadRecentExchanges } from "./archive.js";
import { analyzeImage } from "./files.js";
import { slotPaths } from "./paths.js";
import fs from "fs/promises";
import path from "path";

const HISTORY_DISPLAY_COUNT = 20; // pairs to show in UI history
const histories = {};
function getHistory(slot) {
  if (!histories[slot]) histories[slot] = [];
  return histories[slot];
}

export function createServer(llm, config, onConfigChange) {
  const app = express();
  app.use(express.json({ limit: "20mb" }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,PATCH,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // POST /chat
  app.post("/chat", async (req, res) => {
    const { message, slot = config.defaultSlot } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const send = (type, payload) =>
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

    try {
      histories[slot] = await runAgent(
        message,
        getHistory(slot),
        slot,
        llm,
        { onChunk: text => send("chunk", { text }), onStatus: text => send("status", { text }) },
        config.systemPrompt ?? "",
      );
      send("done", {});
    } catch (err) {
      send("error", { text: err.message });
    }

    res.end();
  });

  // DELETE /chat/:slot — clear history
  app.delete("/chat/:slot", (req, res) => {
    histories[req.params.slot] = [];
    res.json({ ok: true });
  });

  // GET /chat/:slot/history — rebuild from archive (persistent across restarts)
  app.get("/chat/:slot/history", async (req, res) => {
    const { slot } = req.params;
    // Prefer RAM if populated (active session), fall back to disk
    if (histories[slot]?.length) return res.json({ history: histories[slot] });
    const history = await loadRecentExchanges(slot, HISTORY_DISPLAY_COUNT);
    res.json({ history });
  });

  // GET /config
  app.get("/config", (req, res) => res.json(config));

  // PATCH /config
  app.patch("/config", async (req, res) => {
    const allowed = ["model", "baseUrl", "provider", "apiKey", "maxContext", "defaultSlot", "systemPrompt"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) config[key] = req.body[key];
    }
    await onConfigChange?.(config);
    res.json({ ok: true, config });
  });

  // GET /slots
  app.get("/slots", async (req, res) => {
    const entries = await fs.readdir(path.resolve("conversations"), { withFileTypes: true }).catch(() => []);
    const slots   = entries.filter(e => e.isDirectory()).map(e => e.name);
    res.json({ slots });
  });

  // POST /slots
  app.post("/slots", async (req, res) => {
    const { slot, projectPath = null } = req.body;
    if (!slot) return res.status(400).json({ error: "slot required" });
    const paths = slotPaths(slot);
    await fs.mkdir(paths.base, { recursive: true });
    if (projectPath) {
      const refs = await loadRefs(slot);
      refs.projectPath = projectPath;
      await saveRefs(refs, slot);
    }
    res.json({ ok: true, slot });
  });

  // GET /slots/:slot
  app.get("/slots/:slot", async (req, res) => {
    const { slot } = req.params;
    const [graph, refs, exchanges] = await Promise.all([
      loadGraph(slot),
      loadRefs(slot),
      listExchangeIds(slot),
    ]);
    res.json({ slot, graph, refs, exchangeCount: exchanges.length });
  });

  // Refs
  app.get("/slots/:slot/refs", async (req, res) =>
    res.json(await loadRefs(req.params.slot)));

  app.post("/slots/:slot/refs", async (req, res) => {
    const { path: p } = req.body;
    if (!p) return res.status(400).json({ error: "path required" });
    await addRef(p, req.params.slot);
    res.json({ ok: true });
  });

  app.delete("/slots/:slot/refs", async (req, res) => {
    const { path: p } = req.body;
    if (!p) return res.status(400).json({ error: "path required" });
    await removeRef(p, req.params.slot);
    res.json({ ok: true });
  });

  app.patch("/slots/:slot/refs", async (req, res) => {
    const refs = await loadRefs(req.params.slot);
    if (req.body.projectPath !== undefined) refs.projectPath = req.body.projectPath;
    if (req.body.meta !== undefined) Object.assign(refs.meta, req.body.meta);
    await saveRefs(refs, req.params.slot);
    res.json({ ok: true });
  });

  // Image upload
  app.post("/slots/:slot/image", async (req, res) => {
    const { name, data, mediaType } = req.body;
    if (!name || !data || !mediaType)
      return res.status(400).json({ error: "name, data and mediaType required" });
    try {
      const { label, analysis } = await analyzeImage(data, mediaType, name, llm);
      getHistory(req.params.slot).push({
        role: "user",
        content: `[Image uploaded: ${name} (${label})]\n${analysis}`,
      });
      res.json({ ok: true, label, analysis });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // File browser
  app.get("/slots/:slot/browse", async (req, res) => {
    const refs = await loadRefs(req.params.slot);
    if (!refs.projectPath) return res.status(400).json({ error: "No projectPath set" });
    const root = path.join(refs.projectPath, req.query.sub ?? "");
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      res.json({
        path: root,
        entries: entries.map(e => ({ name: e.name, isDir: e.isDirectory() })),
      });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  return app;
}

export { getHistory };