# Media Integrity (Claw.Emby.MediaIntegrity)

Finds silent corruption (bit rot), missing and unreadable files in your Emby libraries. It does this by comparing each file's MD5 with a stored baseline.

- **Scope:** every Emby library path plus extra folders you add in Settings. All file types are checked, except names matching the exclude patterns.
- **New items:** files of newly added library items are queued for background hashing about 2 minutes after they appear. Hashing waits until a file has gone 60 s without being modified.
- **Full integrity scan:** a scheduled task that runs every 6 months by default.
  - Low priority, one file at a time, with an optional MB/s limit.
  - Pauses automatically during playback.
  - Resumable: Stop or a server restart keeps the position, and "Start over" discards it.
  - Offline drives are never reported as missing.
- **Results:**
  - *changed*: same size and modification time but different content, which is typical of bit rot.
  - *modified*: the file was rewritten. Rewrites of metadata extensions (.nfo, artwork) are accepted automatically.
  - Also reported: *missing*, *unreadable* and *new*.
- **Page:** Main menu → Media Integrity.
  - Problems: accept new hash, re-check, ignore.
  - Browse: by library or by drive/folder, with a searchable, paged file table and per-file history.
  - Activity: past scans and the legacy import.
  - Settings.
- **Notifications:** "Integrity scan summary" and "Integrity problems found" (at most one per scan).
- **Legacy import:** on first start, the old `get-all-hashes.ps1` database (`LegacyDbPath`) is imported from a temporary read-only copy. The original is never opened for writing. Files the old script never hashed (paths containing `'`) are marked *never verified*.

Data is stored in `<Emby data>\claw-mediaintegrity\integrity.db` (SQLite, through Emby's bundled sqlite3).

Tests:
- `tests/Claw.Emby.MediaIntegrity.Tests`: `dotnet run`. Set `LEGACY_DB` and `VERIFY_DIR` to also test against a copy of a real database.
- `tests/web`: `node build-page.js && node test-integrity.js [shotDir]`. Uses fake data only.
