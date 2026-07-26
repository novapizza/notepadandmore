# AI Assistant — spec

## Problem

Every text transformation in NovaPad is a hardcoded command: remove duplicates
(`EditorPane.tsx` `dispatchCommand`), beautify, case conversion, regex find/replace.
Anything the author didn't anticipate is impossible. Users working with logs, CSVs,
exports and config files constantly need one-off transforms that don't justify a
dedicated menu item.

## Solution

An opt-in assistant that reads the open document and answers in natural language, or
proposes a rewrite the user approves. It functions as a macro tool with no macro
language to learn.

**Not in scope:** agentic file access, multi-file operations, tool calling, tab
completion / inline suggestions, non-Gemini providers.

## Constraints that shaped the design

1. **The renderer cannot reach the network.** CSP `connect-src 'self'
   https://google.github.io` is declared in *both* `src/renderer/index.html` and
   `CSP_POLICY` in `src/main/index.ts`. Provider hosts are deliberately **not** added
   there — all HTTP lives in `src/main/ipc/aiHandlers.ts`.
2. **The document is untrusted input to the model**, so model output is untrusted too.
3. **Document text going to a third party must be visible and bounded**, never implicit.
4. **A hallucinated rewrite must not be able to destroy a file**, even recoverably.

## Architecture

```
Settings ▸ AI Assistant ──> ai:set-key ──> safeStorage ──> userData/config/ai-credentials.enc
                                                            (main process only)

AiBadge / Ctrl+Shift+A / Tools menu ──> aiStore.panelOpen ──> AiChatPanel (docked Panel)
                                                                   │
                     buildDocContext(mode) ─────────────────────────┤
                     (live Monaco model, capped, labelled)          │
                                                                   ▼
                                                    ai:send ──> aiHandlers
                                                                   │ net.request
                                                                   │ host-pinned
                                                                   ▼
                                          ai:stream-chunk / -done / -error
                                                                   │
                                       aiStore.onChunk/onDone/onError
                                                                   │
                              ┌────────────────────┬───────────────┴────────┐
                         mode 'chat'          mode 'edit'              mode 'find'
                       markdown bubble      PendingEdit →            openFind('replace')
                                            AiDiffCard →
                                            executeEdits on Apply
```

### Files

| Path | Role |
|---|---|
| `src/main/ai/credentials.ts` | safeStorage key vault. `getKey` is main-only. |
| `src/main/ai/provider.ts` | `AiProvider` interface, system prompts, message assembly. |
| `src/main/ai/gemini.ts` | Gemini v1beta SSE implementation + `PROVIDERS` map. |
| `src/main/ipc/aiHandlers.ts` | IPC surface, hardened transport, request validation. |
| `src/preload/index.ts` | `api.ai` group; stream channels in both allowlists. |
| `src/renderer/src/utils/aiContext.ts` | Context resolution, capping, labelling. |
| `src/renderer/src/store/aiStore.ts` | Transcripts, streaming sinks, pending edits. |
| `src/renderer/src/components/AiAssistant/` | Badge, panel, message, diff card, quick actions, mark. |
| `src/renderer/src/components/SettingsTab/AiSection.tsx` | Key management + model + behaviour. |

## Key decisions

**Docked `Panel`, not an overlay.** Added to the `editor-preview-split` `PanelGroup`
alongside the preview pane. Being a real panel is what lets the user keep reading and
editing while chatting, so it is deliberately **not** in `CLOSE_TOP_OVERLAYS` — it does
not need to be mutually exclusive with Find & Replace.

**Diff-then-apply, never auto-write.** Edit-mode replies become a `PendingEdit` rendered
by `AiDiffCard`. `applyEdit` compares `model.getAlternativeVersionId()` against the value
captured when the edit was generated and refuses if the document moved. Apply is a single
`executeEdits('ai-edit', …)` call, so the existing alt-version-id dirty tracking works
unchanged and one `Ctrl+Z` reverts it.

**Structured output for non-chat modes.** Gemini `responseSchema` + `responseMimeType:
application/json` at `temperature: 0`, rather than instructing the model to "reply with
only the text" — which fails often enough to be unusable when the payload is a whole file.

**Regex generation targets Find & Replace, not the document.** `mode: 'find'` returns a
pattern pushed into the existing dialog via `openFind('replace', term)`. Round-tripping a
large file through the model to delete some lines is slow, expensive, and riskier than
handing over a pattern.

**Key never crosses the bridge.** There is no `getKey` on `window.api.ai` by design.
`status()` returns `{ available, hasKey, hint }` with the last-4 hint computed in main.

**Transcripts are in-memory only**, keyed by buffer id. They contain document excerpts;
persisting them would put plaintext file content somewhere the existing backup/cleanup
logic doesn't know about.

## Threat model

| Threat | Mitigation |
|---|---|
| Key exfiltration via a compromised renderer | Plaintext exists only in main; no getter on the bridge; never logged. |
| Key leaking into logs/proxies | Sent as the `x-goog-api-key` header, never a URL query parameter. |
| Key readable at rest | `safeStorage` encryption; storage refused when no backend is available; file mode 0600. |
| Prompt injection from document content | No tools, no filesystem access, no auto-apply. Worst case is text the user must approve in a diff. System prompt frames the context block as untrusted data. |
| XSS from model output | `react-markdown` **without `rehype-raw`**; no `dangerouslySetInnerHTML` anywhere in the AI components. |
| SSRF | Host pinned to a compile-time provider constant, re-checked before every request; **all** redirects rejected; https enforced. |
| Runaway cost / accidental egress | Off by default; per-request char cap; concurrency cap of 4; 120s timeout; 4 MB response cap; context chip states scope before Send. |
| Silent overwrite of concurrent edits | `baseVersionId` staleness check in `applyEdit`. |
| Leaking directory structure | Basename + language sent as metadata; absolute path never sent. |

## Verification

See `tests.md`.
