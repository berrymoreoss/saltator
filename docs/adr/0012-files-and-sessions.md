# 0012. Files and sessions: `.logic.json` on disk, the session restored as it was

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R07 (`feat/persistence`)

## Context

Until R07 a circuit lived only in the tab: a reload lost it, and File ▸ New or an example
replaced it as an undoable edit. The goal is "save, reload, still works" (M1). The document
format exists (R02: `serializeDocument` writes stable, diff-friendly JSON; `parseDocument`
migrates and lists every problem). The app is a static page with no server, used mostly in
Chromium but expected to work in Firefox and Safari. Questions decided at branch start (plan
Q1–Q3): what a reload does with unsaved work, which examples ship, whether to keep recent files.

## Decision

- **Files on disk are the documents.** A circuit is saved to and opened from a `.logic.json`
  file. Chromium uses the File System Access API: pickers, and Save writes back through the
  file's handle (asking for permission again after a reload). Elsewhere Open is a file input
  and Save downloads the file. Both sit behind one `FileAccess` interface with the browser
  primitives injected, so the logic runs in Node tests.
- **A document session** (`DocumentSession`) wraps the editor's circuit: name (the file name
  without `.logic.json`), the loaded document (its other circuits are written back unchanged),
  the file handle, and the circuit as last saved. Unsaved changes = the editor's circuit differs
  from the saved one — by identity, then by value — so undoing back to the save is clean again.
- **Opening replaces the document** (`Editor.setCircuit`: history cleared, simulation stopped),
  after asking **"Save changes?"** (Save / Don't Save / Cancel) when there are unsaved changes.
  New, Open, Open Recent, an example and a dropped file all take this path.
- **The session is restored as it was** (Q1): the document, unsaved changes, name, file handle
  and view are written to IndexedDB at most 500 ms after each change, and synchronously to
  `localStorage` on `pagehide` (IndexedDB writes started during unload don't finish; the next
  start moves newer copies into IndexedDB). Each tab keeps its own session (an id in
  `sessionStorage`, held with Web Locks so a duplicated tab gets its own); a new tab starts from
  the most recent session; a first launch opens Hello, LED. The undo history is not kept.
- **Examples are files** in `examples/`, bundled as text and loaded like any file; their titles
  and descriptions live in `src/app/example-files.ts` (schema v1 has no metadata). Opening one
  gives an untitled copy. A scenario test keeps them canonical. Generated examples (Symbol
  Gallery, stress test) stay in code.
- **Open Recent** (Q3) keeps the last ten file handles in IndexedDB (Chromium only).

## Consequences

- Nothing is lost on a reload, a closed tab or a crash after the last 500 ms, and files on disk
  stay the user's to version (they diff well in git).
- Opening is no longer undoable; the "Save changes?" question replaces that safety net.
- The app renders only after the restore (top-level await on IndexedDB, ~ms); browser tests
  wait for the canvas before pressing keys.
- Firefox and Safari get a weaker Save (every Save downloads a new file) and no Open Recent.
- Two tabs with the same file both write to it; the last Save wins (as with two editors).
- Later: multiple documents per window, simulation settings or notes in the file (schema v2),
  sharing by URL — backlog.

## Alternatives considered

- **Start fresh and offer "Restore unsaved circuit?"** (Q1 b) — an extra click on every start
  for what the user wants nearly always.
- **Circuits kept in the browser, files only for import/export** (Q1 c) — a second storage
  model to build and explain; browser storage can be evicted, and files are what a user
  backs up and versions.
- **Opening as an undoable edit (as before R07)** — the undo history would cross documents and
  files; a desktop-style question is clearer.
- **`beforeunload` prompts** — unneeded with session restore, and browsers limit them.
- **A `fake-indexeddb` dependency for unit tests** — the IndexedDB adapter is thin; a memory
  store tests the logic and Playwright covers the adapter.
