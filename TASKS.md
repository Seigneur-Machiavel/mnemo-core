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
    refs.js      Active file references (refs.json per slot, hot context injection)
    recall.js    Resolve <RECALL anchor="..."> tags from archive
    files.js     File I/O: readFileContent, applyEdit (search/replace + CREATE), analyzeImage
    paths.js     All paths derived from slot name, root = conversations/
    console.js   Interactive readline loop — shares history with API via getHistory()
    api.js       Express HTTP server — owns the shared history store
  conversations/
    <slot>/
      graph.json     Semantic memory
      refs.json      Active refs + projectPath + meta
      seen.json      Dedup set (exchange fingerprints)
      archive/       Raw exchanges as exchange_<timestamp>.json
      images/        (reserved, currently unused — vision is analysed and discarded)
  config.json        (gitignored) your local config
  config.json.example
  TASKS.md           This file
```

## Agent Tags

| Tag | Effect |
|-----|--------|
| `<ADD_REF path="/abs/path" />` | Add file to active context (content visible next turn) |
| `<REMOVE_REF path="/abs/path" />` | Remove file from context (file stays on disk) |
| `<RECALL anchor="node_key" />` | Inline the full raw exchange for that node |
| `<EDIT path="..." ><<<SEARCH>>>...<<<REPLACE>>>...</EDIT>` | Search/replace patch |
| `<EDIT path="..."><<<SEARCH>>><<<REPLACE>>>full content</EDIT>` | CREATE file (empty search) |
| `<STOP status="done\|stuck" />` | End agent loop |

## API Endpoints

| Method | Path | Body / Query | Description |
|--------|------|------|-------------|
| POST | /chat | `{ message, slot? }` | Stream agent response (SSE) |
| DELETE | /chat/:slot | — | Clear in-memory history for slot |
| GET | /config | — | Current config |
| PATCH | /config | Partial config | Hot-update config (rebuilds LLM) |
| GET | /slots | — | List all slots |
| POST | /slots | `{ slot, projectPath? }` | Create a slot |
| GET | /slots/:slot | — | Slot info (graph, refs, exchange count) |
| GET | /slots/:slot/refs | — | Get refs.json |
| POST | /slots/:slot/refs | `{ path }` | Add a ref |
| DELETE | /slots/:slot/refs | `{ path }` | Remove a ref |
| PATCH | /slots/:slot/refs | `{ projectPath?, meta? }` | Update slot meta |
| POST | /slots/:slot/image | `{ name, data, mediaType }` | Analyse image (base64), inject into history |
| GET | /slots/:slot/browse | `?sub=rel/path` | Browse files within projectPath |

## Providers

| Value | Works with |
|-------|-----------|
| `openai-compat` (default) | LM Studio, Ollama, OpenAI |
| `anthropic` | Anthropic API |

Config via `config.json` or env vars: `MNEMO_PROVIDER`, `MNEMO_MODEL`, `MNEMO_BASE_URL`, `MNEMO_API_KEY`, `MNEMO_PORT`, `MNEMO_SLOT`.

## Shared History

Console and API share the same in-memory history per slot via `getHistory(slot)` from `api.js`.
Switching slots in console or calling `DELETE /chat/:slot` clears only that slot's history.

---

## Status

### Done
- [x] Slot-based persistent memory (graph.json)
- [x] Exchange archiving + distillation
- [x] Dedup (seen.json)
- [x] Active refs system (refs.json, hot context injection)
- [x] RECALL tag resolution
- [x] EDIT tag — search/replace + CREATE mode (empty search = new file, creates dirs)
- [x] ADD_REF / REMOVE_REF / STOP tags
- [x] LLM abstraction (openai-compat + anthropic)
- [x] Agent loop with configurable max cycles (MAX_CYCLES = 8)
- [x] Express API with SSE streaming
- [x] Console mode (readline)
- [x] Shared history between console and API
- [x] Image upload via API (base64, vision analysis, injected into history, not stored)
- [x] Slot creation via API (POST /slots)
- [x] Config hot-reload via PATCH /config (rebuilds LLM instance)
- [x] LLM connectivity check at startup

### Pending / Next

- [ ] **Front-end** (separate repo `mnemo-ui`) — conversations per slot, file/image drop, SSE consumer, config panel
- [ ] **Context budget guard** — refs.js injects all ref content blindly; should warn/trim if total chars > maxContext * 0.7 * 4
- [ ] **Text file injection via front** — front sends file content wrapped in `[FILE: name]...[/FILE]` tags in the message body, no upload endpoint needed
