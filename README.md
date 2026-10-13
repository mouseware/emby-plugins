# Emby plugins (LAWMC)

This folder holds the source for the Claw Emby plugins. Do all plugin work here.

| Project | Folder | Version | Output DLL |
|---------|--------|---------|------------|
| Claw Custom Item UI | `Claw.Emby.CustomItemUI` | 1.2.2.0 | `Claw.Emby.CustomItemUI\bin\Release\Claw.Emby.CustomItemUI.dll` |
| Claw IPTV Mapper | `Claw.Emby.IptvMapper` | 1.3.2.0 | `Claw.Emby.IptvMapper\bin\Release\Claw.Emby.IptvMapper.dll` |
| Claw Guard | `Claw.Emby.Guard` | 1.1.0.0 | `Claw.Emby.Guard\bin\Release\Claw.Emby.Guard.dll` |
| Claw Default Chapters | `Claw.Emby.DefaultChapters` | 1.1.1.0 | `Claw.Emby.DefaultChapters\bin\Release\Claw.Emby.DefaultChapters.dll` |

Each project builds on its own. Its `refs\` folder holds copies of the Emby SDK DLLs (`MediaBrowser.Common.dll`, `MediaBrowser.Controller.dll`, `MediaBrowser.Model.dll`), and the csproj HintPaths point there through `$(EmbyServerPath)`, which defaults to `refs`.

The old `E:\APPS\emby-patches\...` folders are a backup only. Don't edit or build there.

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

## Install

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

## Resizable table columns

Every data table in these plugins (Guard, IPTV Channel Mapper, Default Chapters Changed/Found, Custom Item UI dashboard Activity/Alerts) uses the same small resizer, which is copied into each plugin's JS between the `Claw column resize` markers. Keep those copies identical. To resize, drag a header's right edge; widths are saved per table in localStorage under `claw.<plugin>.cols.<table>`; double-click resets. Shared resize test helper: `tests\web` in each plugin (Default Chapters: `test-colresize.js`).
