# Mnemo Core — Task Relay

> This file tracks what's done, what's pending, and open questions.
> Any model picking this up should read it before touching code.

---

## Architecture

```
mnemo-core/
  src/
    index.js     Entry point. Args: "api" | "console" | "both" (default)
    config.js    Config from config.json or env vars (MNEMO_*)
    llm.js       LLM abstraction: openai-compat + anthropic providers
    agent.js     Core loop: build prompt → stream → parse tags → apply → distill
    graph.js     Semantic memory graph (graph.json per slot, in-memory cache)
    distill.js   Compress exchange → graph nodes via LLM
    archive.js   Raw exchange persistence (archive/*.json per slot)
    refs.js      Active file references (refs.json per slot, hot context)
    recall.js    Resolve <RECALL anchor="..."> tags from archive
    files.js     File I/O: read, edit (search/replace), image vision analysis
    paths.js     All paths derived from slot name, root = conversations/
    console.js   Interactive readline loop (console mode)
    api.js       Express HTTP server (API mode)
  conversations/
    <slot>/
      graph.json     Semantic memory
      refs.json      Active refs + projectPath + meta
      seen.json      Dedup set (exchange fingerprints)
      archive/       Raw exchanges as exchange_<timestamp>.json
      images/        Catalogued images + vision transcripts
  config.json        (gitignored) your local config
  config.json.example
  TASKS.md           This file
```

## Agent Tags

The model can emit these in any response:

| Tag | Effect |
|-----|--------|
| `<ADD_REF path="/abs/path" />` | Add file to active context (visible next turn) |
| `<REMOVE_REF path="/abs/path" />` | Remove file from context |
| `<RECALL anchor="node_key" />` | Inline the full raw exchange for that node |
| `<EDIT path="/abs/path"><<<SEARCH>>>...<<<REPLACE>>>...</EDIT>` | Search/replace patch |
| `<STOP status="done\|stuck" />` | End agent loop |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /chat | Stream agent response (SSE) |
| GET | /slots | List all slots |
| GET | /slots/:slot | Slot info (graph, refs, exchange count) |
| GET | /slots/:slot/refs | Get refs.json |
| POST | /slots/:slot/refs | Add a ref `{ path }` |
| DELETE | /slots/:slot/refs | Remove a ref `{ path }` |
| PATCH | /slots/:slot/refs | Update projectPath / meta |
| GET | /slots/:slot/browse?sub= | Browse files within projectPath |

## Providers

| Value | Works with |
|-------|-----------|
| `openai-compat` (default) | LM Studio, Ollama, OpenAI |
| `anthropic` | Anthropic API |

Config via `config.json` or env vars `MNEMO_PROVIDER`, `MNEMO_MODEL`, `MNEMO_BASE_URL`, `MNEMO_API_KEY`, `MNEMO_PORT`, `MNEMO_SLOT`.

---

## Status

### Done
- [x] Slot-based persistent memory (graph.json)
- [x] Exchange archiving + distillation
- [x] Dedup (seen.json)
- [x] Active refs system (refs.json, hot context injection)
- [x] RECALL tag resolution
- [x] EDIT tag (search/replace, safe)
- [x] ADD_REF / REMOVE_REF / STOP tags
- [x] LLM abstraction (openai-compat + anthropic)
- [x] Agent loop with configurable max cycles
- [x] Express API with SSE streaming
- [x] Console mode (readline)
- [x] Image cataloguing + vision analysis

### Pending / Next

- [ ] **Image upload via API** — POST /slots/:slot/images to catalogue an image file
- [ ] **Front-end** (separate repo `mnemo-ui`) — conversations per slot, file/image drop, SSE consumer
- [ ] **Slot creation via API** — POST /slots with initial meta
- [ ] **Graph pruning** — old/stale nodes accumulate; needs a periodic compaction pass
- [ ] **Context budget guard** — refs.js currently injects all ref content blindly; should trim if total > maxContext * 0.7
- [ ] **Config hot-reload** — config.json changes require restart; could watch the file

### Open Questions

- Should the console mode and API mode share conversation history in memory, or stay fully independent sessions? (Currently independent — console has its own in-process history array)
- Vision analysis on upload or on first RECALL? Currently on upload (catalogueFile). Fine for now.
- Should EDIT create the file if it doesn't exist? Currently throws. Could add a CREATE mode.
