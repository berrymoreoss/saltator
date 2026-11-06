# Plan: feat/persistence

| Field      | Value                                                         |
| ---------- | ------------------------------------------------------------- |
| Branch     | `feat/persistence`                                            |
| Roadmap    | R07 — Save, load, examples ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                   |
| Depends on | R02, R04b, R05, R06                                           |
| Created    | 2026-11-07                                                    |

## Goal

Circuits outlive the browser tab. A circuit is saved to and opened from a `.logic.json` file on
disk (File System Access API in Chromium, download/upload elsewhere), nothing is lost on a reload
or a closed tab (autosave to IndexedDB), and a learner starts from ready-made circuits (example
files in the repo, an example gallery, "new from example"). With this branch M1 "Hello, LED" is
reached: build switch → 74HC00 → LED and clock → LED, run it, save, reload, still works.

## Scope

**In scope**

- `ui`: a document session (name, file, saved state, unsaved changes), File menu commands (New,
  Open, Save, Save As, Open Recent (Q3), Examples, New from Example), the "Save changes?" dialog,
  an error dialog for files that don't load, the document name in the browser tab title and the
  menu bar, opening a `.logic.json` dropped onto the window.
- `ui`: file access behind one interface — File System Access (Chromium) and a fallback
  (`<input type=file>`, download); autosave and session restore over IndexedDB (Q1).
- `app`: example files in `examples/*.logic.json` loaded at build time; the example gallery
  (Q2); start-up from the restored session.
- Biome ignores `**/*.logic.json` (it would reformat `serializeDocument`'s layout, lessons R02).
- Tests: unit tests for the pure session model, file-name rules, autosave scheduling and
  session store (in-memory adapter); scenario tests for every example file (loads, compiles
  without design errors, Hello LED runs); Playwright for save/open (stubbed pickers and the
  download/upload fallback), reload restore, the unsaved-changes dialog, the gallery and the M1
  acceptance run.
- Docs: editor.md (Files section, examples), architecture.md (Persistence), ADR-0012, READMEs,
  lessons, roadmap.

**Out of scope** (and where it goes instead)

- Several documents open in one window (tabs) → backlog; a second browser tab is a second window.
- Undo history across a reload → not planned (snapshots are memory-only; a restored session
  starts with an empty history).
- Simulation speed or state in the file → backlog (settings-like session state now, R05; test
  benches in R15 bring their own timing).
- Document metadata in the file (title, description, notes) → backlog; it needs schema v2. Example
  titles and descriptions live in an index next to the files.
- Multiple circuits per document → R11 (but a loaded document's other circuits are kept on save).
- Sharing via URL, cloud storage → backlog (already listed).
- ROM images (`.bin`, Intel HEX) → R12.

## Context

Read before starting:

- [docs/circuit.md](../../docs/circuit.md#loading-versioning-saving) — `parseDocument`,
  `DocumentError` (every problem with its JSON path), migrations, `serializeDocument` (stable,
  one line per item, lossless round trip).
- [docs/editor.md](../../docs/editor.md) — Commands and shortcuts, Settings (localStorage,
  debounced, blocked storage tolerated), Undo and redo ("Opening an example and File ▸ New are
  undoable edits until R07 brings files"), Examples, Editor API (`setCircuit` clears history).
- [ADR-0008](../../docs/adr/0008-desktop-workbench.md) (one command registry, dialogs),
  [ADR-0009](../../docs/adr/0009-editing-model.md) (snapshot undo: immutable circuits).
- `src/ui/workbench-commands.ts` (`open`, `file.*`, `workbenchMenus`), `src/ui/ui-state.ts`
  (`Example`, `createSettingsStore` as the debounced-save pattern), `src/ui/Dialogs.tsx`,
  `src/app/App.tsx`, `src/app/examples.ts`, `src/editor/renderer.ts` (`renderScene` for
  thumbnails), `src/ui/PartPreview.tsx` (a canvas fitted to an element).
- `.ai/lessons.md` — Biome formats JSON (R02), Playwright quirks (R04a, R04b, R05, R06).

## Design

### Document session (`src/ui/document-session.ts`, pure)

```ts
interface DocumentSession {
  readonly name: string; // 'Untitled', or the file name without `.logic.json`
  readonly document: CircuitDocument; // as loaded: circuits after the first are kept on save
  readonly file?: FileRef; // where Save writes (an opaque File System Access handle)
  readonly saved?: Circuit; // the circuit as last opened or saved
}
```

- **Unsaved changes** = the editor's circuit `!==` `saved`. Circuits are immutable snapshots, so
  undoing back to the saved state makes the document clean again, as in desktop apps.
- `documentText(session, circuit)` = `serializeDocument` of the document with `circuits[0]`
  replaced. `fileNameOf(name)` → `name.logic.json`; `nameOfFile('adder.logic.json')` → `adder`
  (also strips `.json`, browser suffixes like ` (1)` are kept as the user's name).
- Title: `name — Logic`, prefixed with `• ` while there are unsaved changes; the menu bar shows
  the name on the right.

### Files (`src/ui/files.ts`)

`FileAccess` with `open()`, `save(text, name, file?)`, `saveAs(text, name)`, picked at start-up
by feature detection:

- **File System Access** (Chromium): `showOpenFilePicker` / `showSaveFilePicker` with the
  `.logic.json` type; Save writes through the kept handle; after a reload the handle (restored
  from IndexedDB) asks for write permission on Save (a user gesture), and falls back to Save As
  if refused.
- **Fallback** (Firefox, Safari): Open is a hidden `<input type=file accept=".logic.json,.json">`;
  Save and Save As download `name.logic.json` (no handle, so every Save downloads).
- A cancelled picker (`AbortError`) is not an error. A file that doesn't load opens nothing and
  shows a dialog with the file name and `DocumentError`'s list (or "saved by a newer version").
  Unknown part types are not load errors (circuit.md).

### Commands (File menu)

| Command           | Shortcut      | Notes                                                       |
| ----------------- | ------------- | ----------------------------------------------------------- |
| New Circuit       | `Mod+Alt+N`   | Chrome reserves `Mod+N` (new window) and can't give it up   |
| Open…             | `Mod+O`       |                                                             |
| Open Recent ▸     | —             | Q3; Chromium only (file handles)                            |
| Save              | `Mod+S`       | Untitled or no handle → Save As; `global` (works in fields) |
| Save As…          | `Mod+Shift+S` |                                                             |
| New from Example… | —             | the gallery (Q2)                                            |
| Examples ▸        | —             | quick submenu, as now                                       |

- New, Open, Open Recent, examples and a dropped file **replace** the document with
  `setCircuit` (history cleared, simulation stopped, zoom to fit) — no longer undoable edits.
  With unsaved changes they first ask **"Save changes to “name”?"** — Save / Don't Save /
  Cancel (Save runs Save, and Save As when needed; a cancelled Save cancels the whole action).
- An example opens as an **untitled copy** named after it (`Hello, LED`): Save asks where.
- Dropping a `.logic.json` file onto the window opens it (with its handle where the browser
  gives one: `getAsFileSystemHandle`).

### Autosave and session restore (`src/ui/autosave.ts`) — Q1

Q1 (a): **the session is restored as it was**, unsaved changes included (like VS Code "hot
exit").

- IndexedDB database `logic`, store `sessions`: `{ id, name, text, dirty, file?, camera,
  updated }` — `text` is `documentText` (the file format, migrated like a file on restore).
- Written on every document change, debounced (500 ms), and at once on `pagehide` /
  `visibilitychange: hidden`; written only when something changed.
- Each browser tab has its own session id (`sessionStorage`), so a reload restores _that_ tab;
  a new tab starts from the most recently updated session (as its own copy). The 10 most recent
  sessions are kept.
- At start-up: this tab's session → the most recent one → first launch: Hello, LED (an untitled
  copy). The restored camera is used; the simulation is stopped; the history is empty. A
  restored `dirty` session stays dirty until saved.
- Storage behind a `SessionStore` interface: IndexedDB in the app, in-memory in unit tests (no
  `fake-indexeddb` dependency); the IndexedDB adapter is covered by Playwright. Blocked storage
  (private mode) means nothing is restored, as with settings.

### Recent files — Q3

In scope (Q3): IndexedDB store `recent` with the last 10 file handles (name, handle,
opened). File ▸ Open Recent lists them (Chromium only; hidden otherwise); opening one asks for
permission (a user gesture); a file that is gone is dropped from the list with a message.

### Examples — Q2

- Files in `examples/` at the repo root: `hello-led.logic.json` (from today's `helloLed` builder,
  written once by a throwaway script, then the file is the source — further edits are made in the
  app and saved), plus the learning circuits (Q2): **half adder** (switches A, B → 74HC86 and
  74HC08 → LEDs Sum, Carry), **SR latch** (buttons /S, /R → two cross-coupled 74HC00 NANDs →
  LEDs Q, /Q), **ring oscillator** (74HC04 inverters in a ring through a 74HC00 NAND enable
  switch, an LED on the output; runs at a slow simulation speed). `src/app/example-files.ts` lists id, file,
  title, one-line description, in gallery order; the app imports the files as raw text
  (`import.meta.glob`, `?raw`) and parses them on demand.
- Symbol Gallery (every registered part, so it must stay generated) and the dev Stress Test stay
  built in code, in the Examples submenu only (dev-only for the stress test, as now).
- **Gallery** (File ▸ New from Example…): a dialog with a card per example — a thumbnail drawn by
  `renderScene` fitted into the card (theme and gate style followed), title, description;
  click opens it (after the unsaved-changes question).
- `?example=<id>` keeps working (opens the example instead of the restored session).

### Testing

- Unit: session model (dirty by identity, undo back to clean, other circuits kept, names),
  file-name rules, autosave scheduling with a fake clock and an in-memory store (debounce, flush
  on hide, no write when unchanged, pruning), restore order, recent list.
- Scenario: every `examples/*.logic.json` parses, round-trips through `serializeDocument`
  byte-for-byte (the file is in the canonical format), compiles with no design issues; Hello LED
  runs (switch → LED, clock blinks); `editing.test.ts` compares against the file.
- Playwright: Save/Open through stubbed File System Access pickers (`addInitScript`); the
  fallback (download event, `setInputFiles`); reload restores an unsaved circuit and its name;
  the unsaved-changes dialog (Save / Don't Save / Cancel); a broken file shows the error; the
  gallery opens Hello, LED; **M1 acceptance**: draw switch → 74HC00 → LED and clock → LED, run,
  save, reload, open the file, run again, the LED follows.

## Tasks

- [x] 1. Examples as files: Biome ignores `**/*.logic.json`; `examples/hello-led.logic.json`
  written from the builder; `src/app/example-files.ts`; the app loads it; scenario test for example
  files; `editing.test.ts` reads the file; the `helloLed` builder removed.
- [x] 2. Document session model + file-name rules (pure, unit tests).
- [x] 3. `FileAccess`: File System Access and fallback implementations, feature detection.
- [x] 4. File commands: New, Open, Save, Save As; open = `setCircuit`; the unsaved-changes and
  load-error dialogs; title and name in the menu bar; drop a file to open; e2e.
- [x] 5. Autosave and session restore (`SessionStore`, IndexedDB adapter, start-up order,
  per-tab sessions, camera); e2e reload restore.
- [ ] 6. Open Recent (Q3).
- [ ] 7. Example gallery dialog with thumbnails; New from Example; e2e.
- [ ] 8. Learning examples (Q2) — half adder, SR latch, ring oscillator — as files, each with a
  scenario test that runs it (truth table, set/reset/hold, oscillation period).
- [ ] 9. M1 acceptance e2e; look at it in the browser (both themes).
- [ ] 10. Docs: editor.md (Files, examples, history note), architecture.md (Persistence),
  ADR-0012, `src/ui` / `src/app` READMEs, lessons, roadmap (R07 `done`, R08 `next`, backlog
  items from Out of scope).

## Acceptance criteria

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] Save writes a `.logic.json` that `parseDocument` reads back to the same circuit; Save on a
  saved file writes to the same file without a picker (Chromium).
- [ ] Open loads a file; a broken file shows its problems and leaves the document alone.
- [ ] Firefox/Safari path: Open via file input, Save downloads (tested in Chromium with the
  File System Access API hidden).
- [ ] New/Open/example with unsaved changes asks Save / Don't Save / Cancel, and each does what
  it says.
- [ ] A reload (and a closed and reopened tab) restores the circuit, its name and unsaved state.
- [ ] The gallery shows every example with a thumbnail; opening one gives an untitled copy.
- [ ] Every example file loads, is canonical, has no design issues and runs.
- [ ] M1: switch → 74HC00 → LED and clock → LED built in the browser, run, saved, reloaded, still
  works.

## Open questions

- [x] Q1. Autosave model — _proposed:_ (a) restore the session as it was, unsaved changes
  included; alternatives: (b) start fresh and offer "Restore unsaved circuit?"; (c) a list of
  circuits kept in the browser, files as import/export only — **answer:** (a), restore as it
  was.
- [x] Q2. Which examples ship in R07 — _proposed:_ Hello, LED plus a few learning circuits built
  from the 74HC gates we have: half adder (74HC86 + 74HC08), SR latch (74HC00), ring
  oscillator (74HC04 with a NAND enable), 3-state bus (two 74HC125 drivers on one line) —
  **answer:** Hello, LED, half adder, SR latch, ring oscillator (no bus example).
- [x] Q3. Open Recent (Chromium only) — _proposed:_ in R07 — **answer:** in R07.

## Progress log

- 2026-11-07 — plan drafted; Q1 (a), Q2 (Hello LED, half adder, SR latch, ring oscillator), Q3
  (Open Recent in R07) answered.
- 2026-11-07 — plan approved; started.
- 2026-11-07 — task 1: `examples/hello-led.logic.json` written once from the old builder (all
  resolved props, wires normalized), then the builder removed; `src/app/example-files.ts`
  (index + `import.meta.glob` `?raw`, eager) kept apart from `examples.ts`, which the benchmark
  imports natively (no `import.meta.glob` there); `tests/scenarios/examples.test.ts` keeps files
  canonical. Tests are typed without Node APIs: list files with `import.meta.glob`, not `fs`.
- 2026-11-07 — tasks 2–4: `document-session.ts` (pure), `files.ts` (native + fallback, browser
  primitives injected), `document-controller.ts` (New/Open/Save/Save As/examples/drop; asks and
  reports through callbacks wired to `UiState.unsavedQuestion` / `fileProblem`; one file
  operation at a time). Opening is `setCircuit` now (not undoable). `Mod+Alt+N` for New: with Alt
  a shortcut's letter is read from `event.code` (⌥N types `˜` on a Mac). The shortcuts dialog got
  File and Simulate sections (Simulate was missing). E2E stubs the pickers in memory
  (`addInitScript`) and hides them for the fallback; specs have no Node types — read a download
  with `for await` over `createReadStream()`, hand files over by path (`download.saveAs`).
  Docs (editor.md history note, Files section) still to update in task 10.
- 2026-11-07 — task 5: `Autosave` (debounced 500 ms on document, session or camera changes —
  camera too, because IndexedDB writes during unload aren't reliable; selection clicks and
  pointer moves don't push a pending write back) + flush on hide; `restoreSession`,
  `sessionToRestore`, `claimSessionId` (sessionStorage id + Web Locks: a duplicated tab gets its
  own id and copies the session); IndexedDB adapter in `browser-storage.ts` (version 1,
  `sessions` with an `updated` index); App awaits the restore before rendering (top-level await);
  `setCircuit(circuit, { camera })` cancels the pending fit. E2E pickers return OPFS handles
  (`navigator.storage.getDirectory()`): real, cloneable into IndexedDB, persistent across reloads.

## Handoff

- **State:** tasks 1–4 done: examples as files, session model, `FileAccess`, File commands with
  `DocumentController` (`src/ui/document-controller.ts`), dialogs, title, drop; e2e `files.spec.ts`;
  autosave (`src/ui/autosave.ts`, `browser-storage.ts`, start-up in `App.tsx`); e2e
  `autosave.spec.ts`.
- **Next step:** task 6 (Open Recent; bump the IndexedDB version to add a `recent` store).
- **Watch out:** Biome reformats `.json` (exclude `**/*.logic.json` first); Chrome reserves
  `Mod+N`.
- **Verify with:** `pnpm check`, `pnpm e2e`.
