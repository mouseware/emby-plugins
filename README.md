# Claw Emby plugins

Five plugins for Emby Server, one per subfolder:

- **Claw Guard**: bans IP addresses after failed sign-ins, nonexistent or instant-ban usernames, or repeated 401/403 API calls. Bans are enforced through Emby's own Remote IP filter. It has a live log, ban management, escalation rules, a whitelist, optional GeoLite2 country lookup, and an import from Emby's existing logs.
- **Claw IPTV Channel Mapper**: a spreadsheet-style editor for IPTV channels (number, name, group, logo, guide mapping, enabled), with undo, snapshots and bulk actions. 1.4 adds Export/Import of the whole mapping as one .zip (mapper.json plus a logos/ folder), with a preview (Merge or Replace, All channels or Matching only) before anything is applied.
- **Claw Default Chapters**: generates "Chapter 1, 2 …" interval chapters for movies that have few or no chapters, from the item menu or in bulk (Found movies), with revert.
- **Claw Custom Item UI**: item-page link tweaks, VLC path links, a rearrangeable admin dashboard, and Activity/Alerts tables on the dashboard.
- **Media Integrity**: finds bit rot, missing and unreadable files by comparing each library file's MD5 with a stored baseline. It has a resumable, low-priority full scan (scheduled task), background hashing of new items, "Verify integrity" in the item menu, a live **Check now** on any file, folder or library, search across all files, per-file history, and an import of the old `get-all-hashes.ps1` database. 1.0.5 skips Emby metadata, artwork and `.old` backups by default (subtitles and media stay hashed), and a file-list refresh drops skipped rows from tracking without touching the files on disk. 1.0.6 adds a sortable File type column with a type filter to the file tables.

All data tables have resizable columns. The widths are saved per table in the browser.

Every plugin has a **General** tab like Custom Item UI: an **Enable plugin** switch and an About section (version, injected script if any, GitHub link). Switching a plugin off stops its features cleanly and keeps its data:

- **Guard**: removes its entries from the Remote IP filter and stops banning (events are still logged).
- **IPTV Channel Mapper**: Save and Import are blocked and the Channel Name Guide provider returns no channels or programs. Export still works.
- **Default Chapters**: the item-menu entries disappear, Generate is refused and refreshes no longer re-apply interval chapters. Revert still works.
- **Media Integrity**: the full scan, background hashing, file-list refresh and manual checks stop, and the item-menu entry disappears. Queued work waits until it is switched on again.

| Project | Folder | Version | Output DLL |
|---------|--------|---------|------------|
| Claw Custom Item UI | `Claw.Emby.CustomItemUI` | 1.2.3.0 | `Claw.Emby.CustomItemUI\bin\Release\Claw.Emby.CustomItemUI.dll` |
| Claw IPTV Mapper | `Claw.Emby.IptvMapper` | 1.4.1.0 | `Claw.Emby.IptvMapper\bin\Release\Claw.Emby.IptvMapper.dll` |
| Claw Guard | `Claw.Emby.Guard` | 1.2.0.0 | `Claw.Emby.Guard\bin\Release\Claw.Emby.Guard.dll` |
| Claw Default Chapters | `Claw.Emby.DefaultChapters` | 1.2.0.0 | `Claw.Emby.DefaultChapters\bin\Release\Claw.Emby.DefaultChapters.dll` |
| Media Integrity | `Claw.Emby.MediaIntegrity` | 1.0.6.0 | `Claw.Emby.MediaIntegrity\bin\Release\Claw.Emby.MediaIntegrity.dll` |

Each project builds on its own. Its `refs\` folder holds copies of the Emby SDK DLLs (`MediaBrowser.Common.dll`, `MediaBrowser.Controller.dll`, `MediaBrowser.Model.dll`), and the csproj HintPaths point there through `$(EmbyServerPath)`, which defaults to `refs`.

## Screenshots

The screenshots use made-up sample data: documentation IP ranges, fake users and generic titles. They are grouped by plugin under `docs/screenshots/<plugin>/`.

### Claw Guard

| | |
|---|---|
| ![Live log with summary cards and filters](docs/screenshots/guard/live-log.png)<br/>Live log with summary cards and filters | ![Actions on a log row (ban, whitelist, watch)](docs/screenshots/guard/row-menu.png)<br/>Actions on a log row (ban, whitelist, watch) |
| ![Active bans and history](docs/screenshots/guard/bans.png)<br/>Active bans and history | ![Rules and escalation](docs/screenshots/guard/rules.png)<br/>Rules and escalation |
| ![Whitelist](docs/screenshots/guard/whitelist.png)<br/>Whitelist | ![Import from Emby logs](docs/screenshots/guard/import.png)<br/>Import from Emby logs |
| ![Settings (MaxMind, retention, filter status)](docs/screenshots/guard/settings.png)<br/>Settings (MaxMind, retention, filter status) | ![General tab: Enable switch and About](docs/screenshots/guard/general.png)<br/>General tab: Enable switch and About |

### Claw IPTV Channel Mapper

| | |
|---|---|
| ![Channel table (number, name, group, logo, guide, enabled)](docs/screenshots/iptv-mapper/channels.png)<br/>Channel table (number, name, group, logo, guide, enabled) | ![Import preview (Merge, all channels)](docs/screenshots/iptv-mapper/import-preview.png)<br/>Import preview (Merge, all channels) |
| ![Import preview (Replace, matching only)](docs/screenshots/iptv-mapper/import-replace.png)<br/>Import preview (Replace, matching only) | ![Export with all logos: summary with failed downloads](docs/screenshots/iptv-mapper/export-summary.png)<br/>Export with all logos: summary with failed downloads |
| ![General tab: Enable switch, Backup, About](docs/screenshots/iptv-mapper/general.png)<br/>General tab: Enable switch, Backup, About |   |

### Claw Default Chapters

| | |
|---|---|
| ![Changed movies (with Revert)](docs/screenshots/default-chapters/changed.png)<br/>Changed movies (with Revert) | ![Found movies (bulk Generate)](docs/screenshots/default-chapters/found.png)<br/>Found movies (bulk Generate) |
| ![General tab: Enable switch and About](docs/screenshots/default-chapters/general.png)<br/>General tab: Enable switch and About |   |

### Claw Custom Item UI

| | |
|---|---|
| ![Dashboard Activity/Alerts tables](docs/screenshots/custom-item-ui/dashboard-tables.png)<br/>Dashboard Activity/Alerts tables | ![Settings (tabs)](docs/screenshots/custom-item-ui/settings.png)<br/>Settings (tabs) |

### Media Integrity

| | |
|---|---|
| ![Problems while a full scan runs](docs/screenshots/media-integrity/problems-running.png)<br/>Problems while a full scan runs | ![Problems filtered by file type](docs/screenshots/media-integrity/problems-type.png)<br/>Problems filtered by file type |
| ![Problems: select all and bulk actions](docs/screenshots/media-integrity/problems-select-all.png)<br/>Problems: select all and bulk actions | ![Live Check now (in-row progress)](docs/screenshots/media-integrity/checknow-progress.png)<br/>Live Check now (in-row progress) |
| ![Browse by library](docs/screenshots/media-integrity/browse-library.png)<br/>Browse by library | ![Browse a library (expanded)](docs/screenshots/media-integrity/browse-expanded.png)<br/>Browse a library (expanded) |
| ![File type column and filter](docs/screenshots/media-integrity/browse-type-filter.png)<br/>File type column and filter | ![Browse by folder](docs/screenshots/media-integrity/browse-folder.png)<br/>Browse by folder |
| ![Library with files not yet hashed](docs/screenshots/media-integrity/untracked-library.png)<br/>Library with files not yet hashed | ![Checking a whole library](docs/screenshots/media-integrity/check-library.png)<br/>Checking a whole library |
| ![Two manual batches queued](docs/screenshots/media-integrity/two-batches.png)<br/>Two manual batches queued | ![Select a page of files](docs/screenshots/media-integrity/select-page.png)<br/>Select a page of files |
| ![Select all matching files](docs/screenshots/media-integrity/select-all-matching.png)<br/>Select all matching files | ![Search all files by status](docs/screenshots/media-integrity/global-search.png)<br/>Search all files by status |
| ![Per-file history](docs/screenshots/media-integrity/history.png)<br/>Per-file history | !["Verify integrity" in the item menu](docs/screenshots/media-integrity/item-menu.png)<br/>"Verify integrity" in the item menu |
| ![Result toast (OK)](docs/screenshots/media-integrity/item-toast-ok.png)<br/>Result toast (OK) | ![Result toast (changed file) with a link](docs/screenshots/media-integrity/item-toast-changed.png)<br/>Result toast (changed file) with a link |
| ![Past scans and import](docs/screenshots/media-integrity/activity.png)<br/>Past scans and import | ![Manual checks in Activity](docs/screenshots/media-integrity/activity-manual.png)<br/>Manual checks in Activity |
| ![Settings (skip list, schedule)](docs/screenshots/media-integrity/settings.png)<br/>Settings (skip list, schedule) | ![General tab: Enable switch and About](docs/screenshots/media-integrity/general.png)<br/>General tab: Enable switch and About |
| ![Switched off: banner](docs/screenshots/media-integrity/off-banner.png)<br/>Switched off: banner |   |

## Install (from a release)

Requires **Emby Server 4.10.1 or newer** (built against the 4.10.1 SDK, .NET 8).

1. Download the DLLs you want from the [latest release](../../releases/latest), or download `claw-emby-plugins-<tag>.zip` with all five.
2. Stop Emby Server, including the tray app.
3. Copy the `.dll` files into Emby's plugins folder. This is the `plugins` folder in Emby's data folder: `%APPDATA%\Emby-Server\plugins` for a Windows user install, or `/var/lib/emby/plugins` for the Linux packages. Overwrite older versions.
4. Start Emby Server. The plugins appear under **Dashboard → Plugins**, Guard (shield) and Media Integrity (health_and_safety) also get main-menu entries. Hard-refresh the browser (Ctrl+F5) so it doesn't use cached pages.

**Guard takes over Emby's Remote IP filter.** On first start it switches *Settings → Network → Remote IP filter* to **blacklist** mode and manages its own entries there. Entries you added yourself are kept. If the filter is an allow-list (whitelist mode) with entries, Guard does not change it and shows "Not enforcing" instead. LAN, loopback and private addresses are never banned. Turning Guard's master switch off removes its entries. Read `Claw.Emby.Guard/README.md` before installing.

## Build

In PowerShell:

```powershell
# 1. Refresh PATH so dotnet is found (a long-running shell may have a stale PATH)
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# 2. Build one project
cd E:\Apps\Emby-plugins\Claw.Emby.CustomItemUI      # or ...\Claw.Emby.IptvMapper
dotnet build -c Release

# Optional: build against the live server's DLLs instead of refs\
#   dotnet build -c Release /p:EmbyServerPath=$env:APPDATA\Emby-Server\system

# Optional: release file locks held by the build server
dotnet build-server shutdown
```

The output DLL lands in `<Project>\bin\Release\<Project>.dll`, for example
`E:\Apps\Emby-plugins\Claw.Emby.CustomItemUI\bin\Release\Claw.Emby.CustomItemUI.dll`.

Check the version:

```powershell
(Get-Item .\bin\Release\Claw.Emby.CustomItemUI.dll).VersionInfo.FileVersion
```

## Install (from source)

Emby locks plugin DLLs while it runs, and the tray app (`embytray.exe`) restarts the server. Stop both before copying.

```powershell
# 1. Stop EmbyServer AND all embytray processes
Get-Process EmbyServer, embytray -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Wait until both are really gone
while (Get-Process EmbyServer, embytray -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }

# 3. Copy the DLL into the plugins folder (overwrites the old version)
Copy-Item 'E:\Apps\Emby-plugins\Claw.Emby.CustomItemUI\bin\Release\Claw.Emby.CustomItemUI.dll' "$env:APPDATA\Emby-Server\plugins\" -Force
#   or ...\Claw.Emby.IptvMapper\bin\Release\Claw.Emby.IptvMapper.dll
#   or ...\Claw.Emby.Guard\bin\Release\Claw.Emby.Guard.dll  (Guard takes over Settings > Network > Remote IP filter; read Claw.Emby.Guard\README.md first)

# 4. Start Emby again
Start-Process "$env:APPDATA\Emby-Server\system\EmbyServer.exe"
```

Then confirm the new version under Dashboard → Plugins:

```powershell
Get-ChildItem "$env:APPDATA\Emby-Server\plugins\Claw*.dll" | Select-Object Name, @{n='Version';e={$_.VersionInfo.FileVersion}}
```

**Afterwards, hard-refresh the browser (Ctrl+F5, or Ctrl+Shift+R).** Emby's web client caches its pages and scripts, so without a hard refresh you may still see the old plugin settings page or the old injected script.

## Tests

- Guard: `cd Claw.Emby.Guard\tests\Claw.Emby.Guard.Tests; dotnet run` runs the offline engine tests. The UI tests (`tests\web`, Puppeteer + Chrome) were run on the build box.
- Media Integrity: `cd Claw.Emby.MediaIntegrity\tests\Claw.Emby.MediaIntegrity.Tests; dotnet run` runs the engine, import and manual-queue tests. Set `LEGACY_DB` (and `VERIFY_DIR`) to also test against a temporary copy of a real legacy database. The UI tests are in `tests\web` (`test-integrity.js`, `test-inject.js`) and use fake data only.

## Resizable table columns

Every data table in these plugins (Guard, IPTV Channel Mapper, Default Chapters Changed/Found, Custom Item UI dashboard Activity/Alerts) uses the same small resizer, which is copied into each plugin's JS between the `Claw column resize` markers. Keep those copies identical. To resize, drag a header's right edge; widths are saved per table in localStorage under `claw.<plugin>.cols.<table>`; double-click resets. Shared resize test helper: `tests\web` in each plugin (Default Chapters: `test-colresize.js`).
