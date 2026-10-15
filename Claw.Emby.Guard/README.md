# Claw Guard (Claw.Emby.Guard) 1.2.0.0

Guard bans IP addresses that attack the Emby login or API. It enforces bans **inside Emby**, through Emby's own *Remote IP filter* in blacklist mode (Settings > Network). It adds no firewall rules or helper service, and it never locks Emby user accounts: only addresses are banned.

You can open it from the main menu (**Guard**, shield icon) or from its tile under Plugins. It is for admins only.

## Tabs

- **Live log**: Guard events, refreshed every 4 s. It has summary cards (failed sign-ins and failed API calls in the last 24 h, active bans, distinct IPs, enforcement state), filters (text, event type, time range, pause) and sortable columns. Click a row to get: Ban 1 h / 1 day / 30 days / permanently, Whitelist this IP, Watch username (adds it to the instant-ban list), and Show only this IP.
- **Bans**: active bans, which you can Unban, give +1 day, or Make permanent. You can also add a manual ban (IP or CIDR, with a duration). History lists expired and lifted bans; escalation uses it.
- **Rules**: thresholds, the instant-ban usernames, the API-failure rule, the escalation steps, when escalation resets, the IPv6 prefix and notifications.
- **Whitelist**: IPs or CIDRs that are never banned. It starts empty, and admin IPs are not trusted automatically. A note explains that LAN addresses are never filtered by Emby.
- **Settings**: the optional MaxMind credentials, log retention and the filter status.
- **General** (1.2): the **Enable plugin** master switch (switching off asks first; Guard then removes its entries from the Remote IP filter and stops banning, but keeps logging) and an About section with the version, "Script: None" (Guard injects nothing into other pages) and the GitHub link.

## Detection (per event type)

| Event | Source | Rule |
|---|---|---|
| Failed sign-in | `ISessionManager.AuthenticationFailed` (username, remote IP, client, device) | **5 failures in 10 min** bans the address. |
| Unknown username | same event; `IUserManager.GetUserByName` returns nothing | **2 tries** (configurable, 0 = off). With **Ban non-existent usernames instantly** (Rules tab, default off) the first try bans. |
| Instant-ban username | same event; the name is in the list (root, admin, administrator, emby, test, guest, user, sa, support, oracle, postgres, ubnt, pi, ftp, demo, default, jellyfin, plex, ...) | Banned on the first try. **This is skipped when the name is a real Emby user**, so a real user (for example "guest" on this server) can't ban themselves by mistyping their password. |
| Forbidden sign-in | `embyserver.txt`: `Response 403` on `/Users/AuthenticateByName` (for example, a user who is not allowed remote access) | Counts as a failed sign-in. |
| API 401 / 403 | `embyserver.txt` tailed every 2 s. Emby logs `... Response 401 to <ip> ... GET <url>` at Info level (it wraps the IP in invisible U+200C/U+200D characters, which Guard strips). | **30 in 10 min** (configurable, can be turned off). Plugins have no global HTTP response hook, so the log is the only source. 401s on the sign-in endpoint are skipped because the auth event already counts them. Only the path is kept; query strings and tokens are never stored. |
| Successful sign-in | `ISessionManager.AuthenticationSucceeded` | Logged. It resets that address's failure counters. |
| Blocked | a request from an address that is already banned | Logged, and added to the ban's hits. |

**Escalation:** the default steps are 1 h, then 1 day, then 30 days, then permanent, and you can edit them on Rules. Each new automatic ban on an address takes the next step after the address's previous automatic ban, as long as that ban ended less than *EscalationResetDays* (default 30) ago. Otherwise it starts again at step 1.

**Safety:**
- Loopback, private ranges (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, fc00::/7, fe80::/10) and Emby's LAN are never banned. Failures from them are logged only.
- Whitelisting an address lifts any active ban on it.
- Banning the address you are using right now needs a second explicit confirmation.
- IPv4-mapped IPv6 addresses are normalised to IPv4. IPv6 is banned by prefix (default /64).
- Bans survive restarts (`<DataPath>\claw-guard\bans.json`).

## Import from Emby logs (1.1)

The **Import from Emby logs** button (Live log tab) reads every `embyserver*.txt` in Emby's log folder (the current file plus the rotated ones Emby keeps for `LogFileRetentionDays`). It adds past attacks to Guard's log with their **original timestamps** and runs them through the ban rules in time order.

- Lines are grouped by request id, so one request becomes one event. Invisible and bidi marks around IPs are stripped.
  - `AUTH-ERROR: <ip> - Invalid username or password entered.` becomes a failed sign-in. The username comes from the `No user named X exists` line just before it.
  - `Response 403` on a sign-in endpoint becomes a forbidden sign-in.
  - Every other `Response 401/403 to <ip>` becomes a failed API call. Token `AUTH-ERROR` lines are covered by their 401 line.
- **Dedupe:** each item gets a key (time, request id and kind) stored in `claw-guard\imported-keys.txt`. Items that Guard already logged live (same kind and IP within 5 s) are skipped, so the import is safe to run any number of times.
- **Rules:** bans are created at the original time. One that has already run out ends at its original expiry and goes into the history, where it still counts for escalation. A ban that would still be running is enforced. LAN, loopback and whitelisted addresses are never banned. Historical bans send no notifications.
- The result dialog shows the imported count and a breakdown: sign-ins, forbidden, API, LAN, skipped, bans created and still active, files and lines read, and the period covered.

## Column widths

Drag the right edge of a column header to resize it. Widths are saved per table in this browser (localStorage `claw.guard.cols.live` / `.bans` / `.history` / `.whitelist`). Double-click an edge to reset.

## Blacklist sync (Remote IP filter)

Every 60 s, and after every change, Guard computes the filter:

- **Manual entries are kept.** Any entry Guard didn't add is left alone. Guard records the entries it owns in `bans.json` and only adds or removes those.
- If the filter is empty or already in blacklist mode, Guard switches it to **blacklist** and writes *manual entries + active bans*. It saves the server configuration only when something actually changed.
- If the filter is in **whitelist (allow-list) mode with entries**, Guard does **not** flip it, because that would open the server to everyone. The status shows "Not enforcing (allow-list conflict)" until you clear or convert the list.
- **Master switch off:** Guard removes only its own entries. It puts back the original filter mode when no manual entries are left. Detection keeps logging.
- If you uninstall Guard while it is enabled, its entries stay in the filter. Turn Guard off first, or clear them under Settings > Network.

## Country (optional, MaxMind GeoLite2)

When you enter a MaxMind account ID and license key, Guard downloads GeoLite2-Country (and refreshes it weekly), and a **Country** column appears. With no key, no column is shown and nothing is downloaded. If you clear the key, the database is deleted. This keeps to the GeoLite EULA: data must be kept updated, and old copies deleted within 30 days. GeoLite is free for non-commercial use under that EULA.
*This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com.*

## Logs and retention

Events go to `<DataPath>\claw-guard\events\yyyy-MM-dd.jsonl`. Retention follows Emby: Emby 4.10.1 has no activity-log retention setting (it keeps the activity log forever), so Guard keeps its events forever too. Emby's own text logs are kept for `LogFileRetentionDays` (3 here). The Settings tab shows both values.

## Notifications

Guard sends one Emby notification per ban, as the event **"Guard: IP address banned"**. To receive it, enable it for a notifier under Settings > Notifications.

## Caveats

- Emby applies the Remote IP filter itself. Whether a filter change takes effect without a restart in 4.10.1 has not been verified live yet; check this after installing.
- API 401/403 detection depends on the text format of `embyserver.txt`. If Emby changes the format, that rule goes quiet. Sign-in rules don't depend on the log.
- Shared, CGNAT or VPN exit addresses can ban innocent people. Use the whitelist.
- Behind a reverse proxy, every request would appear to come from the proxy. This server has none (Emby listens directly on 8096/8920).
- The MaxMind license key is stored in plain text in the plugin's XML configuration.

## Build and test

```powershell
cd E:\Apps\Emby-plugins\Claw.Emby.Guard
dotnet build -c Release            # bin\Release\Claw.Emby.Guard.dll
cd tests\Claw.Emby.Guard.Tests; dotnet run   # offline engine + import tests
dotnet run -- --scan "$env:APPDATA\Emby-Server\logs"   # dry-run: what an import would find (counts only)
```

`tests\web` holds an offline UI harness: a mock ApiClient plus the real guard.html and guard.js. `node tests\web\test-guard.js` needs puppeteer-core and Chrome.
