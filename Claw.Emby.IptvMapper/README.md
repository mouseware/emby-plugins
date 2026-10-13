# Claw.Emby.IptvMapper

Emby Server plugin: **IPTV Channel Mapper**. A dashboard table for editing IPTV Live TV channels, meant as a better replacement for Emby's built-in channel mapping.

- One row per tuner channel, across all M3U tuners.
- **v1.3.1:** Cleaner dialog layout. The logo dialog has a left-aligned tool row (Upload image…, Copy from channel…, Use M3U logo, Clear override) and a separate right-aligned footer (Cancel, Apply). All buttons have the same height, margins are reset, and narrow screens get a 2×2 grid. Snapshot row buttons don't wrap. Esc in the copy-from-channel picker closes only the picker.
- **v1.3:** **Channel Name Guide**, a built-in dummy guide data provider (type `clawdummy`, `Guide/ChannelNameGuideProvider.cs`).
  - For channels with no real guide (UFC Network, PPV/"EVENT 1: …" channels): one solid 24-hour tile per day, local midnight to local midnight in the server's time zone (23h/25h on DST days).
  - Tile title = the channel's current M3U name, read from Emby's tuner cache at every guide refresh, so renames show up after the next Refresh Guide. Genres = the M3U group.
  - Opt-in per channel: guide channel ids are `cng_<tunerId>_<channelId>`, names carry a " (name guide)" suffix and have no number, so Emby's automatic matching never picks it.
  - Setup: click **Enable Channel Name Guide** (shown only while no instance exists). It calls the official `POST LiveTv/ListingProviders` with `EnableAllTuners=true`, and Emby queues Refresh Guide.
  - Choosing "Channel Name Guide" as a row's guide source (or with bulk "Set guide source…") sets that row's own dummy channel automatically. Then Save.
- **v1.2:**
  - **Upload a logo from this computer** (the browser's machine) via file picker, drag-and-drop or paste.
    - PNG/JPEG are uploaded byte-for-byte; WebP/GIF/SVG are converted to PNG via canvas; max 5 MB, downscaled above 2048 px.
    - Bulk: "Upload logo for selected…". Image data stays in browser memory only; the override records `LogoSource="upload"` + `LogoFileName`.
  - **Missing logo / Has logo** status filter (current Emby Primary image).
  - **Set guide source…** for selected rows (Auto / None / provider). A provider keeps the current guide channel only when it exists in that provider; otherwise the channel is cleared to choose.
- **v1.1:**
  - Editable **group**, stored in the TvChannel Tags (locked), with a combobox of existing groups.
  - **Copy logo from another channel**, for one channel or in bulk via row checkboxes.
- Columns: logo, number, name, tuner, M3U group, guide source, guide channel, status and enabled.
- Number and name are edited inline. The guide channel uses a searchable fuzzy combobox. Logo URL overrides open in a preview dialog.
- Status chips: Mapped, Unmapped, Conflict (two channels on one guide channel), Duplicate #, Disabled and Save error.
- Toolbar:
  - Search, plus filters for tuner, group, guide source and status.
  - Pending-changes counter, with changed cells highlighted and a per-row revert.
  - Undo and Redo (also Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z).
  - Save (sequential batch with progress and per-row errors) and Discard all.
  - Sortable headers, Snapshots (rollback) and Reload.

Everything stays inside Emby. M3U files and tuner URLs are never modified, and the page never POSTs `System/Configuration/livetv`. The only provider write is the explicit Enable Channel Name Guide button.

## Requirements

- Emby Server 4.10.x (built against 4.10.1 DLLs from this machine).
- .NET 8 SDK to compile.

## Build

```powershell
cd E:\APPS\emby-patches\Claw.Emby.IptvMapper
# refs\ holds copies of MediaBrowser.Common/Controller/Model.dll from this server.
# Or build against live Emby: dotnet build -c Release /p:EmbyServerPath=$env:APPDATA\Emby-Server\system
dotnet build -c Release
```

Output: `bin\Release\Claw.Emby.IptvMapper.dll`. This is the only file to deploy; the HTML, JS and thumb.png are embedded.

## Install (requires an Emby restart)

1. Copy `bin\Release\Claw.Emby.IptvMapper.dll` into `%APPDATA%\Emby-Server\plugins\`.
2. Restart Emby Server.
3. Hard-refresh the web app (Ctrl+F5). Open **IPTV Channel Mapper** from the dashboard main menu, or go to Plugins → IPTV Channel Mapper.
4. Sanity check: `GET /emby/IptvMapper/Ping` (admin token) returns `{"Plugin":"Claw.Emby.IptvMapper",...}`.

Uninstall: delete the DLL and restart. Saved overrides stay in `plugins\configurations\Claw.Emby.IptvMapper.xml`.

## How it works

### Server side (read-only)

`GET /emby/IptvMapper/Channels` is admin-only (`[Authenticated(Roles = "Admin")]`). It joins three sources:

- `LiveTvOptions` (TunerHosts and ChannelOptions) from the `livetv` named configuration.
- The tuner caches in `data\livetv\tuner_<id>_channels`, for tvg-id, M3U name/number/group and tvg-logo.
- `LiveTvChannel` library items, for item id, current name/number, LockedFields and the primary image tag.

It never returns stream URLs. A tvg-logo is dropped if it carries userinfo or shares a host with the stream URL.

### Client side

The page also reads `LiveTv/Manage/Channels`, which gives the *effective* guide mapping (including auto-matches), and `LiveTv/ListingProviders`.

If the plugin endpoint is unavailable, the page falls back to the official endpoints only. In that mode tvg-id, group and M3U data are missing, and override keys are name-based.

### Save

Save runs sequentially, using only Emby's official endpoints, in this order:

1. Number/name/group: `GET Users/{me}/Items/{id}`, set `Name`/`ChannelNumber`/`TagItems`+`Tags`, add `Name`/`ChannelNumber`/`Tags` to `LockedFields`, then `POST Items/{id}` so tuner refreshes keep the edit.
   - Emby's item update uses `TagItems` when present.
   - `LiveTvManager.GetChannel` skips Tags while `MetadataFields.Tags` is locked.
   - Resetting a group to the M3U value restores the M3U tags and removes the `Tags` lock.
2. Logo URL: `POST Items/{id}/RemoteImages/Download?Type=Primary&ImageUrl=...`
   - Logo copy runs after the URL downloads:
     1. Fetch `Items/{src}/Images/Primary` (original size) as a blob.
     2. Re-encode it to PNG via canvas if it isn't PNG or JPEG.
     3. `POST Items/{target}/Images/Primary` with a base64 body and `Content-Type: image/png|image/jpeg`. This matches the web client's `uploadItemImage`.
3. Guide: `POST LiveTv/ChannelMappings`. The form body is `providerId`, `tunerChannelId` (the ManagementId) and `providerChannelId`, the same as Emby's metadata editor. An empty `providerId` means Auto; `none` means no guide.
4. Enabled: `POST LiveTv/Manage/Channels/{id}/Disabled?ManagementId=...&Disabled=true|false`

Item writes run first because disabling a channel deletes its library item. Each guide or enable call queues Emby's channel refresh task.

After a save, the page stores override records and a snapshot in the plugin configuration (last 10 snapshots), then reloads. Failed edits stay pending, and each one shows its error.

### Override records

Records are keyed by a stable key: `tunerHostId|tvg:<tvg-id>`, falling back to `tunerHostId|name:<normalized m3u name>`. Each record stores:

- The desired values.
- The last-known ManagementId and ItemId.
- The M3U values seen at the time of the edit, for a future "source changed" flag.
- v1.1 adds `Group` (null means M3U/unlocked), `LogoSourceItemId` and `LogoSourceKey`.

## Column widths (1.3.2.0)

Column widths: drag the right edge of any column header to resize it. Widths are saved per table in this browser (localStorage `claw.iptvmapper.cols.channels`). Double-click an edge to reset the table to automatic widths. The header stays sticky.

## Not in v1 (code is structured for it)

- Auto-match suggestions.
- Bulk renumber.
- CSV/JSON import and export.
- A background task that re-attaches overrides after channels are re-keyed (tuner URL change).
- Stale ChannelOptions cleanup.

## Icon

`thumb.png` (640x360) is Google Material Symbols "developer_mode_tv" (Apache License 2.0), drawn #52B54B on #1c1c1c. The source SVG is in `Assets\`.

## Plugin id

`e5b612ae-cad5-47e9-8fb3-27a029c220d3`. Do not change it once installed; Emby stores the configuration by id.
