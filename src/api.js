import express from "express";
import { runAgent } from "./agent.js";
import { loadRefs, saveRefs, addRef, removeRef } from "./refs.js";
import { loadGraph } from "./graph.js";
import { listExchangeIds } from "./archive.js";
import fs from "fs/promises";
import path from "path";

export function createServer(llm, config) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // CORS for local front
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // --- Chat (streaming SSE) ---
  // POST /chat
  // Body: { message, slot?, history? }
  // Streams: data: { type: "chunk"|"status"|"done", ... }
  app.post("/chat", async (req, res) => {
    const { message, slot = config.defaultSlot, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const send = (type, payload) =>
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

    try {
      const finalHistory = await runAgent(message, history, slot, llm, {
        onChunk:  text => send("chunk",  { text }),
        onStatus: text => send("status", { text }),
      });
      send("done", { history: finalHistory });
    } catch (err) {
      send("error", { text: err.message });
    }

    res.end();
  });

  // --- Slot info ---
  // GET /slots
  app.get("/slots", async (req, res) => {
    try {
      const dir = path.resolve("conversations");
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      const slots = entries.filter(e => e.isDirectory()).map(e => e.name);
      res.json({ slots });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  // --- Refs management ---
  // GET /slots/:slot/refs
  app.get("/slots/:slot/refs", async (req, res) => {
    res.json(await loadRefs(req.params.slot));
  });

  // POST /slots/:slot/refs  body: { path }
  app.post("/slots/:slot/refs", async (req, res) => {
    const { path: p } = req.body;
    if (!p) return res.status(400).json({ error: "path required" });
    await addRef(p, req.params.slot);
    res.json({ ok: true });
  });

  // DELETE /slots/:slot/refs  body: { path }
  app.delete("/slots/:slot/refs", async (req, res) => {
    const { path: p } = req.body;
    if (!p) return res.status(400).json({ error: "path required" });
    await removeRef(p, req.params.slot);
    res.json({ ok: true });
  });

  // PATCH /slots/:slot/refs  body: { projectPath }
  app.patch("/slots/:slot/refs", async (req, res) => {
    const refs = await loadRefs(req.params.slot);
    if (req.body.projectPath !== undefined) refs.projectPath = req.body.projectPath;
    if (req.body.meta !== undefined) Object.assign(refs.meta, req.body.meta);
    await saveRefs(refs, req.params.slot);
    res.json({ ok: true });
  });

  // --- File browser (within projectPath) ---
  // GET /slots/:slot/browse?sub=relative/path
  app.get("/slots/:slot/browse", async (req, res) => {
    const refs = await loadRefs(req.params.slot);
    if (!refs.projectPath) return res.status(400).json({ error: "No projectPath set for this slot" });

    const sub  = req.query.sub ?? "";
    const root = path.join(refs.projectPath, sub);
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
