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
- **Moved files (1.0.7):** when files are moved or renamed outside Emby, their old rows show as *missing* and the new paths as new files. Media Integrity can match them up and keep the history.
  - **Likely moved hint:** after every full scan and file-list refresh, a missing row shows *likely moved: <path>* when a new file (not yet hashed, only just hashed, or first seen after the old one was last seen) has the same file name and size. It is a hint only; nothing is changed.
  - **Find moved files** (Problems toolbar, for the selected missing files or all of them): candidates are new files with the same size on every library and extra folder, plus untracked files in optional extra folders (any drive). Same file name first; renamed candidates (a few per file) only for files still unresolved. Candidates are hashed in the manual-check queue, with progress in the usual panel; a candidate whose hash is already known is compared without reading it. Only an identical MD5 counts. Read-only until you migrate.
  - **Results:** old path → new path with a **confidence** (high: same MD5 and name; medium: same MD5, renamed; low: same name and size, not confirmed) and the match type. **Migrate** (per row or **Migrate all confirmed**) moves the record and its whole check history to the new path, removes the duplicate row of the new path, adds a *moved* check and logs the move in Activity. A match whose new file changed since it was hashed is skipped. **Ignore** (not the same file) is remembered; neither the search nor the hint suggests that pair again. Low-confidence rows offer **Verify & relink** instead.
  - **Relink** (missing rows): enter the new path; the file is hashed and relinked only when it matches the baseline. If it doesn't, the dialog explains why and offers **Relink anyway**, which makes the new hash the baseline (recorded as *moved-forced*). A path that is already tracked with its own history (a copy) is refused.
  - Files on disk are never touched. While the plugin is switched off (General tab), Find, Migrate and Relink are refused.
- **Page:** Main menu → Media Integrity.
  - Problems: accept new hash, **Check now** (a live hash; the row updates in place), ignore, **Find moved files**, **Relink** and Forget on missing rows.
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
- `tests/Claw.Emby.MediaIntegrity.Tests`: `dotnet run`. Set `LEGACY_DB` and `VERIFY_DIR` to also test against a copy of a real database, and `MI_DB_COPY` (a copy of `integrity.db`) for a read-only moved-files dry run (no file is hashed).
- `tests/web`: `node build-page.js && node test-integrity.js [shotDir]` for the page and `node test-inject.js [shotDir]` for the item menu. Both use fake data only.

## Changes

- **1.0.7.0**
  - **Find moved files**, **Migrate**, **Ignore** and **Relink** for missing files, plus a *likely moved* hint from normal scans (see *Moved files* above). API: `POST /ClawMediaIntegrity/Moves/Find` (`Ids`, `Folders`), `GET /ClawMediaIntegrity/Moves`, `POST .../Moves/Migrate` (`Ids`, empty = all confirmed), `POST .../Moves/Ignore` (`Id`, `Path`), `POST .../Moves/Clear`, `POST .../Files/{Id}/Relink` (`Path`, `Force`). Searches and relinks are jobs of the manual-check queue (`Kind` = `moves` / `relink`; `Outcome` and `Message` carry the result).
  - Database: column `files.move_hint`, table `move_ignores`, index on `files(size)`. The last search result is kept, so it shows again after a reload or restart.
  - Activity: type **Moved files** for searches, migrations and relinks; the entry lists the moved files.
  - Fix: the Type cell of file tables no longer breaks the row layout; row action buttons don't wrap.
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

All images are in [docs/screenshots/media-integrity/](../docs/screenshots/media-integrity/).

| | |
|---|---|
| ![Problems while a full scan runs](../docs/screenshots/media-integrity/problems-running.png)<br/>Problems while a full scan runs | ![Problems filtered by file type](../docs/screenshots/media-integrity/problems-type.png)<br/>Problems filtered by file type |
| ![Problems: select all and bulk actions](../docs/screenshots/media-integrity/problems-select-all.png)<br/>Problems: select all and bulk actions | ![Live Check now (in-row progress)](../docs/screenshots/media-integrity/checknow-progress.png)<br/>Live Check now (in-row progress) |
| ![Missing files with a "likely moved" hint and Relink](../docs/screenshots/media-integrity/moves-hints.png)<br/>Missing files with a "likely moved" hint and Relink | ![Find moved files: scope and extra folders](../docs/screenshots/media-integrity/moves-dialog.png)<br/>Find moved files: scope and extra folders |
| ![Find moved files: hashing candidates in the progress panel](../docs/screenshots/media-integrity/moves-progress.png)<br/>Find moved files: hashing candidates in the progress panel | ![Moved files found: confidence, match, Migrate / Ignore](../docs/screenshots/media-integrity/moves-results.png)<br/>Moved files found: confidence, match, Migrate / Ignore |
| ![Relink a missing file (prefilled with the hint)](../docs/screenshots/media-integrity/relink-dialog.png)<br/>Relink a missing file (prefilled with the hint) | ![Relink: hash does not match, Relink anyway offered](../docs/screenshots/media-integrity/relink-mismatch.png)<br/>Relink: hash does not match, Relink anyway offered |
| ![Browse by library](../docs/screenshots/media-integrity/browse-library.png)<br/>Browse by library | ![Browse a library (expanded)](../docs/screenshots/media-integrity/browse-expanded.png)<br/>Browse a library (expanded) |
| ![File type column and filter](../docs/screenshots/media-integrity/browse-type-filter.png)<br/>File type column and filter | ![Browse by folder](../docs/screenshots/media-integrity/browse-folder.png)<br/>Browse by folder |
| ![Library with files not yet hashed](../docs/screenshots/media-integrity/untracked-library.png)<br/>Library with files not yet hashed | ![Checking a whole library](../docs/screenshots/media-integrity/check-library.png)<br/>Checking a whole library |
| ![Two manual batches queued](../docs/screenshots/media-integrity/two-batches.png)<br/>Two manual batches queued | ![Select a page of files](../docs/screenshots/media-integrity/select-page.png)<br/>Select a page of files |
| ![Select all matching files](../docs/screenshots/media-integrity/select-all-matching.png)<br/>Select all matching files | ![Search all files by status](../docs/screenshots/media-integrity/global-search.png)<br/>Search all files by status |
| ![Per-file history](../docs/screenshots/media-integrity/history.png)<br/>Per-file history | !["Verify integrity" in the item menu](../docs/screenshots/media-integrity/item-menu.png)<br/>"Verify integrity" in the item menu |
| ![Result toast (OK)](../docs/screenshots/media-integrity/item-toast-ok.png)<br/>Result toast (OK) | ![Result toast (changed file) with a link](../docs/screenshots/media-integrity/item-toast-changed.png)<br/>Result toast (changed file) with a link |
| ![Past scans and import](../docs/screenshots/media-integrity/activity.png)<br/>Past scans and import | ![Manual checks in Activity](../docs/screenshots/media-integrity/activity-manual.png)<br/>Manual checks in Activity |
| ![Moves and relinks in Activity](../docs/screenshots/media-integrity/activity-moves.png)<br/>Moves and relinks in Activity | ![Settings (skip list, schedule)](../docs/screenshots/media-integrity/settings.png)<br/>Settings (skip list, schedule) |
| ![General tab: Enable switch and About](../docs/screenshots/media-integrity/general.png)<br/>General tab: Enable switch and About | ![Switched off: banner](../docs/screenshots/media-integrity/off-banner.png)<br/>Switched off: banner |
