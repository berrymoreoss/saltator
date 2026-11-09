# 0032. Saltator: the product name, `.saltator.json` documents, fresh browser storage

- **Status:** accepted
- **Date:** 2026-11-10
- **Roadmap item:** — (chore/rename-saltator)

## Context

The project goes public under the `berrymoreoss` GitHub org (Berrymore Open Source). "Logic" was
a working title: a common word that is hard to find in search and close to Logic Pro. The org
names its products with proper names (birds for now), each with a pixel-art icon. The name is
baked into the app in several places: the page and window titles, the About dialog, the VCD
`$version`, the document extension `.logic.json` (save, open, the examples, the headless runner,
Biome's ignore list), the file pickers' ids and descriptions, the drag MIME type, and the browser
storage (IndexedDB `logic`, `logic.settings.v1`, `logic.session`, `logic.unload.*`, Web Locks
`logic.session.*`). Nobody but the author has used the app, so nothing outside this repository
depends on any of these.

## Decision

- The product is **Saltator** (Latin _saltare_, to leap; also a genus of songbirds), always
  introduced as "Saltator — digital logic simulator". The name lives in one constant
  (`APP_NAME` in `src/ui`) plus the literal in `index.html`. "Logic" stays where it means digital
  logic (logic levels, the logic analyzer, the logic probe).
- Documents are **`.saltator.json`**. There is no legacy extension: an old `.logic.json` file
  still loads as generic `.json` (it is the same format) and takes the name `adder.logic` until
  renamed by hand.
- Browser storage moves to **`saltator` / `saltator.*`** with no migration. The author's old
  autosaved session, view settings and Open Recent stay behind under the old keys once; open
  documents are saved to files before updating.
- The history keeps the old name: done plans, accepted ADRs and the descriptions of done roadmap
  items are not rewritten.
- The repo is MIT-licensed.

## Consequences

- One rename now, before anyone outside depends on the names; nothing to maintain afterwards.
- No migration code and no second extension in the file code, the pickers or the tests.
- The author's browser loses its autosave and settings once; old files need a rename to get a
  clean name.
- File pickers remember their folders by id; the new ids start fresh.

## Alternatives considered

- **Keep "Logic"** — unsearchable and generic; the org wants proper names with their own icons.
- **Also recognise `.logic.json` when opening** — clean names for old files, but a second
  extension in the picker types, the name handling and their tests forever, for a handful of
  files on one machine.
- **Migrate `logic.*` storage on first start** — keeps one browser's session and settings, at
  the cost of permanent migration code and its tests.
- **Keep the `logic.*` storage keys** — invisible to users and free, but leaves the old name
  inside the code of a published product.
