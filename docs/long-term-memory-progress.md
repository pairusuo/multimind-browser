# Long-Term Memory Progress

## Goal

Implement the first usable long-term memory foundation for MultiMind Flow:

- Markdown authorized-directory inbox
- user-confirmed import into local SQLite memory snapshots
- FTS5 search
- minimal memory library UI

## Architecture Decision

Long-term memory follows the Source / Inbox / Memory model:

- Source: Markdown files, pasted Markdown, and future API-generated summaries are candidate inputs.
- Inbox: scanned candidates from user-authorized directories are reviewed before import.
- Memory: confirmed document snapshots are stored in the app data SQLite database and indexed for search.

The authorized directory is not the memory database and is not a live mirror. Source file deletion must not delete confirmed memory documents.

## Progress Log

- 2026-07-14: Confirmed architecture and updated `MultiMind_设计文档_v0.2.md` and `AGENTS.md`.
- 2026-07-14: Started implementation. Existing IPC/UI patterns inspected; `docs/` already contained unrelated proposal files, so this dedicated progress file was added without touching them.
- 2026-07-14: Installed `better-sqlite3` and `@types/better-sqlite3`.
- 2026-07-14: Added main-process `MemoryStore` with schema migration, import sources, Markdown inbox scanning, hash deduplication, document version rows, FTS5 search, and source-missing markers.
- 2026-07-14: Added memory IPC channels, preload bridge methods, directory picker handler, and `better-sqlite3` `asarUnpack` packaging config.
- 2026-07-14: Added first renderer memory UI: authorized-directory inbox, Markdown preview/edit, confirm import, search, view, and disable memory.
- 2026-07-14: Build passed. Initial Electron runtime failed because `better-sqlite3` was compiled for Node ABI 127; rebuilt it for Electron ABI 130 and added dynamic `rebuild:native` / `postinstall` scripts that read the installed Electron version.
- 2026-07-14: `npm run dev` starts without SQLite/native module errors.
- 2026-07-14: Moved the memory library entry out of the top toolbar and into Settings, keeping the toolbar consolidated behind the existing settings button.
- 2026-07-14: Removed the ignore candidate flow and moved the Memory Library close button back to the panel header.
- 2026-07-14: Added authorized-directory removal. Removing a directory only revokes the scan source; it does not delete imported memory snapshots or user files.
- 2026-07-15: Manual memory workflow was reported as passed: add directory, scan Markdown, preview, confirm import, search, disable, restore, remove directory, source-missing check, and restart persistence.
- 2026-07-15: Duplicate candidate behavior was reported as passed for the main scenarios: same Markdown across multiple directories, same content under different filenames, and near-identical content with whitespace changes.
- 2026-07-15: Packaged macOS smoke test was reported as passed: packaged app opens the memory library and can import/search Markdown using the local app data directory.
- 2026-07-15: Added `npm run test:memory` and `scripts/test-memory-store.mjs` to cover the core `MemoryStore` flow with a temporary scan directory.

## Implementation Checklist

- [x] Add `better-sqlite3` dependency.
- [x] Add shared memory types and IPC channels.
- [x] Implement main-process memory store and schema migrations.
- [x] Implement authorized directory selection and Markdown inbox scanning.
- [x] Implement confirm import, search, list, read, and disable-memory APIs.
- [x] Implement restore flow for disabled memory found again in authorized-directory inbox.
- [x] Add preload bridge methods.
- [x] Add minimal renderer UI for inbox and memory search.
- [x] Add lightweight automated `MemoryStore` workflow test.
- [x] Run TypeScript/build verification.

## Verification

- `npm run build` passes.
- `npm run dev` starts Vite and Electron without `better-sqlite3` ABI errors after native rebuild.
- `npm run test:memory` passes after rebuilding `better-sqlite3` for the local Electron ABI.
- Manual UI workflow has been validated with a real Markdown directory: add folder, scan, preview, import, search, disable, restore, remove source, source-missing recovery, and restart persistence.
- macOS packaged-app smoke test has been validated locally. Packaging does not include the developer's app data; development and installed builds only appeared to share data because they use the same Electron app data directory on this machine.

## Open Decisions

- First UI will start as a modal/panel to avoid changing the browser grid architecture.
- Schema supports multiple authorized directories; the first UI can expose the same capability without adding a separate settings page.
- Current "Disable memory" keeps the SQLite record but removes it from active search/FTS and future AI context recall.
- Disabled memory can be restored from the inbox when scanning finds the same source file or same content hash again.
- Next useful UI additions are imported-memory editing, source path display/opening, and tag filtering.
- Hard-delete memory records is a separate future operation and is not implemented yet.
