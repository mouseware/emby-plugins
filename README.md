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

The screenshots use made-up sample data: documentation IP ranges, fake users and generic titles.

| | |
|---|---|
| ![Guard live log](docs/screenshots/guard-live-log.png) Guard: live log | ![Guard row menu](docs/screenshots/guard-row-menu.png) Guard: actions on a log row |
| ![Guard bans](docs/screenshots/guard-bans.png) Guard: bans and history | ![Guard rules](docs/screenshots/guard-rules.png) Guard: rules and escalation |
| ![Guard import](docs/screenshots/guard-import.png) Guard: import from Emby logs | ![Guard settings](docs/screenshots/guard-settings.png) Guard: settings |
| ![Guard whitelist](docs/screenshots/guard-whitelist.png) Guard: whitelist | ![IPTV Mapper](docs/screenshots/iptvmapper-channels.png) IPTV Channel Mapper |
| ![Default Chapters changed](docs/screenshots/defaultchapters-changed.png) Default Chapters: changed movies | ![Default Chapters found](docs/screenshots/defaultchapters-found.png) Default Chapters: found movies |
| ![Custom Item UI dashboard](docs/screenshots/customitemui-dashboard-tables.png) Custom Item UI: dashboard tables | ![Custom Item UI settings](docs/screenshots/customitemui-settings.png) Custom Item UI: settings (tabs) |
| ![Media Integrity problems](docs/screenshots/mediaintegrity-problems-running.png) Media Integrity: problems while a full scan runs | ![Media Integrity check now](docs/screenshots/mediaintegrity-checknow-progress.png) Media Integrity: live Check now (in-row progress) |
| ![Media Integrity browse](docs/screenshots/mediaintegrity-browse-expanded.png) Media Integrity: browse a library | ![Media Integrity check library](docs/screenshots/mediaintegrity-check-library.png) Media Integrity: checking a whole library |
| ![Media Integrity search](docs/screenshots/mediaintegrity-global-search.png) Media Integrity: search all files by status | ![Media Integrity history](docs/screenshots/mediaintegrity-history.png) Media Integrity: per-file history |
| ![Media Integrity item menu](docs/screenshots/mediaintegrity-item-menu.png) Media Integrity: "Verify integrity" in the item menu | ![Media Integrity toast](docs/screenshots/mediaintegrity-item-toast-changed.png) Media Integrity: result toast with a link |
| ![Media Integrity activity](docs/screenshots/mediaintegrity-activity.png) Media Integrity: past scans and import | ![Media Integrity settings](docs/screenshots/mediaintegrity-settings.png) Media Integrity: settings |
| ![Media Integrity type filter](docs/screenshots/mediaintegrity-browse-type-filter.png) Media Integrity: File type column and filter | ![Media Integrity general](docs/screenshots/mediaintegrity-general.png) Media Integrity: General tab |
| ![IPTV import preview](docs/screenshots/iptvmapper-import-preview.png) IPTV Channel Mapper: import preview (Merge) | ![IPTV import replace](docs/screenshots/iptvmapper-import-replace.png) IPTV Channel Mapper: import preview (Replace, matching only) |
| ![IPTV general](docs/screenshots/iptvmapper-general.png) IPTV Channel Mapper: General tab, backup | ![Guard general](docs/screenshots/guard-general.png) Guard: General tab |
| ![Default Chapters general](docs/screenshots/defaultchapters-general.png) Default Chapters: General tab | ![IPTV export summary](docs/screenshots/iptvmapper-export-summary.png) IPTV Channel Mapper: export with all logos (summary) |

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
