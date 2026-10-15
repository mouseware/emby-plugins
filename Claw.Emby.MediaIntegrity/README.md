# Media Integrity (Claw.Emby.MediaIntegrity)

Finds silent corruption (bit rot), missing and unreadable files in your Emby libraries. It does this by comparing each file's MD5 with a stored baseline.

- **Scope:** every Emby library path plus extra folders you add in Settings. All file types are checked, except names matching the exclude patterns.
- **New items:** files of newly added library items are queued for background hashing about 2 minutes after they appear. Hashing waits until a file has gone 60 s without being modified.
- **Full integrity scan:** a scheduled task. Its trigger fires weekly, but it only scans when the last full verification is older than `MinDaysBetweenScheduledScans` (default 182 days, so about every 6 months). Emby cannot run interval triggers longer than about 49 days.
  - Low priority, one file at a time, with an optional MB/s limit.
  - Pauses automatically during playback.
  - Resumable: Stop or a server restart keeps the position, and "Start over" discards it.
  - Offline drives are never reported as missing.
- **Results:**
  - *changed*: same size and modification time but different content, which is typical of bit rot.
  - *modified*: the file was rewritten. Rewrites of metadata extensions (.nfo, artwork) are accepted automatically.
  - Also reported: *missing*, *unreadable* and *new*.
- **Verify integrity (item "…" menu, 1.0.2):** shown for administrators on movies, episodes, series, seasons, folders, libraries and other media items, and for several selected items at once.
  - A file item is checked together with its companion files (same base name: `.nfo`, subtitles, `-poster.jpg`).
  - A series, season, folder or library is checked recursively from its folder on disk, plus tracked files that have since disappeared (these are reported as missing).
  - A toast shows the result (OK / new / CHANGED / missing / unreadable) with an **Open Media Integrity** link.
  - The menu entry is added by a small script that the plugin writes into Emby's `dashboard-ui` folder, the same way Default Chapters does.
- **Manual checks (1.0.2):** "Verify integrity", **Check now**, **Check selected** and **Check this library/folder** run in their own background queue.
  - They are separate from the full scan, so they also run while the scan is paused or stopped.
  - Only the speed limit applies to them; they don't pause for playback, because you asked for them.
  - Progress shows in the same panel as the scan: file x of y, current file, speed, time left, result counts, and a Cancel button.
- **Page:** Main menu → Media Integrity.
  - Problems: accept new hash, **Check now** (a live hash; the row updates in place), ignore.
  - Browse:
    - search across all files with a status filter (OK, never verified, changed, modified, missing, unreadable, problems, ignored);
    - grouped by library or by drive/folder, each with a **Check this library/folder** button;
    - a searchable, paged file table with row checkboxes, **Check selected**, a per-row **Check now** that shows the percentage and speed in the row, and per-file history.
  - Activity: past scans and the legacy import.
  - Settings.
- **Notifications:** "Integrity scan summary" and "Integrity problems found" (at most one per scan).
- **Legacy import:** on first start, the old `get-all-hashes.ps1` database (`LegacyDbPath`) is imported from a temporary read-only copy. The original is never opened for writing. Files the old script never hashed (paths containing `'`) are marked *never verified*.

Data is stored in `<Emby data>\claw-mediaintegrity\integrity.db` (SQLite, through Emby's bundled sqlite3).

Tests:
- `tests/Claw.Emby.MediaIntegrity.Tests`: `dotnet run`. Set `LEGACY_DB` and `VERIFY_DIR` to also test against a copy of a real database.
- `tests/web`: `node build-page.js && node test-integrity.js [shotDir]` for the page and `node test-inject.js [shotDir]` for the item menu. Both use fake data only.

## Changes

- **1.0.6.0**
  - **File type column.** The Problems table and every file table under Browse (library, folder and search boxes) have a **Type** column with the file extension. It sorts like the other columns, and a **type filter** dropdown lists the extensions with their counts (server-side via `GET /ClawMediaIntegrity/Files/Types`; `Type` is also accepted by `Files` and `Check/Matching`, so "Check all matching" respects the filter). Columns stay resizable.
  - **General tab** with an **Enable plugin** switch and an About section (version, injected script `claw-media-integrity.js`, GitHub link). Switching off asks first, then stops the full scan (it resumes later), the background hashing, the file-list refresh and manual checks, and hides "Verify integrity" in the item menu. Hashes and history are kept; a banner shows the off state. `GET /ClawMediaIntegrity/Info` returns `{ Enabled, Version }`.
  - Fix: dragging a column edge in a file table inside the Browse groups table resized the outer table instead (same fix in all plugins).
- **1.0.5.0**
  - **Emby metadata and artwork are skipped by default.** The recommended skip list is `*.nfo`, `*.nfo-orig`, `*.xml`, `*.bif`, `*.metathumb`, artwork (`*.jpg`, `*.jpeg`, `*.png`, `*.webp`, `*.tbn`, `*.gif`), Emby backups (`*.old*`), plus the existing junk patterns (`Thumbs.db`, `desktop.ini`, `.DS_Store`, `*.tmp`, `*.part`, `*.partial`, `*.crdownload`, `*.!qB`).
    - Subtitles (`.srt`, `.ass`, `.ssa`, `.sub`, `.idx`, `.vtt`) and all media, including video, audio, `.iso` and ebooks, stay hashed.
    - The skip list stays fully editable in Settings, with a one-line explanation of skip versus auto-accept. **Restore recommended skip list** adds the recommended patterns without removing your own.
    - A saved configuration is never overwritten; only a fresh install (or a user with no saved config) gets the new defaults.
  - **A file-list refresh drops rows that now match the skip list.** That includes OK rows and their check history, and it happens at startup, after library changes, after saving settings, and from Refresh file list. The refresh log reports how many were removed.
    - Files on disk are never touched.
    - Saving a skip-list change that would remove more than 1,000 tracked rows asks for confirmation first, and shows how many would be removed.
  - Auto-accept still applies to rewrites of metadata extensions that are not skipped.

- **1.0.4.0**
  - **Every file on disk is listed.** A cached disk enumeration ("file list") covers every library of any type (audiobooks, books, music, home videos and so on) plus the extra folders.
    - Files the database does not know yet are added as **Not yet hashed**. They show in Browse, in search and in the status filter, and are counted on the summary rows and the Problems tab.
    - They can be checked with Check now, Check selected and Check this library/folder.
    - The file list is refreshed at startup, after library changes (debounced by 60 s), when settings change, and on demand with **Refresh file list**.
    - Files that were never hashed and are gone again are dropped, not reported as missing.
  - Libraries with 0 tracked files are listed, with a hint in the empty table.
  - New library items of every type, including folder items such as audiobooks and albums, queue their files for a baseline.
  - The Problems tab shows "N files not yet hashed", with **Show in Browse** and **Check all not yet hashed**.
  - "(old database)" only shows while imported files without a verified hash remain. A file leaves "Never verified" with its first plugin hash.
  - Browse, search and Problems page at 100 rows. Gmail-style selection: "All 100 on this page selected. Select all N matching files" and "Clear selection". Select-all checks send the filter to the server (Check/Matching), not the ids, and ask for confirmation above 2,000 files.
  - **Activity** lists manual checks (Check now, Check selected, select-all, Check this library/folder, item-menu Verify integrity) next to scheduled and full scans, plus one **New media** entry per day.
    - Columns: Type, What was checked, Started, Ended, Duration, Result, Files and result counts. There is also a type filter.
    - Click an entry to see its problem files, then click a file for its history. Combined batches are one entry.
  - New Emby task **Manual integrity check** (no triggers). It starts automatically when manual work is queued and shows progress on the dashboard. Cancelling it cancels the queue, and it ends when the queue is empty. The full scan task still reports its own progress.

- **1.0.3.0**
  - Fix: a second Check selected or Check this library/folder batch now joins the running manual check instead of starting a hidden separate job. The total grows (file x of y), the panel shows "N batches combined", and rows in every batch update live. Files that are already queued are not added again.
  - The progress panel now has two bars for both the full scan and manual checks. The top bar shows overall progress (file x of y, percent, time left). The bar under it shows the file being hashed (name, percent of bytes read, speed).
  - Job polling returns snapshots, with `?Since=n` for only the newer results.

- **1.0.2.0**
  - New "Verify integrity" entry in the item "…" menu.
  - Browse: Check now, Check selected, and Check this library/folder.
  - Problems: Check now replaces Re-check.
  - Live in-row progress.
  - Search across all files with a status filter.
  - Manual-check queue that is separate from the full scan.
- **1.0.1.0**
  - Fix: Emby failed to start with 1.0.0.0, because its interval timers cannot exceed about 49 days. The trigger is now weekly, and the 6-month cadence comes from `MinDaysBetweenScheduledScans` (182 days).
- **1.0.0.0**
  - First version.

## Screenshots (fake data)

`docs/screenshots/mediaintegrity-*.png` in the repository root.
