using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using Claw.Emby.Guard.Core;
using MediaBrowser.Controller.Authentication;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Notifications;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Controller.Session;
using MediaBrowser.Common.Net;
using MediaBrowser.Model.Events;
using MediaBrowser.Model.Logging;

namespace Claw.Emby.Guard.Server
{
    /// <summary>
    /// Wires Guard into Emby:
    ///  - sign-ins: ISessionManager.AuthenticationFailed / AuthenticationSucceeded (username, RemoteAddress, app, device);
    ///  - forbidden sign-ins + failed API calls: tails embyserver.txt for "Response 401/403 to &lt;ip&gt;" lines
    ///    (Info level, always logged; Emby has no plugin hook for HTTP responses);
    ///  - enforcement: keeps Emby's Remote IP filter in blacklist mode with the active bans.
    /// </summary>
    public class GuardEntryPoint : IServerEntryPoint, IGuardHost
    {
        public static GuardEntryPoint Instance { get; private set; }

        private readonly ISessionManager _sessions;
        private readonly IServerConfigurationManager _config;
        private readonly IUserManager _users;
        private readonly INetworkManager _network;
        private readonly INotificationManager _notifications;
        private readonly ILogger _log;
        private readonly object _syncLock = new object();
        private Timer _tailTimer, _sweepTimer, _geoTimer;
        private LogTailer _tailer;
        private int _tailBusy;
        private bool _syncing;

        public GuardEngine Engine { get; private set; }
        public GuardStore Store { get; private set; }
        public GeoService Geo { get; private set; }
        public string FilterState { get; private set; } = "starting";
        public int ManualFilterCount { get; private set; }
        public string TailStatus { get; private set; } = "starting";
        public DateTimeOffset? LastTailLine { get; private set; }
        public DateTimeOffset Started { get; private set; } = DateTimeOffset.UtcNow;

        public GuardEntryPoint(ISessionManager sessions, IServerConfigurationManager config, IUserManager users,
            INetworkManager network, INotificationManager notifications, ILogManager logManager)
        {
            _sessions = sessions; _config = config; _users = users; _network = network; _notifications = notifications;
            _log = logManager.GetLogger("ClawGuard");
        }

        public void Run()
        {
            Instance = this;
            var dir = Path.Combine(_config.ApplicationPaths.DataPath, "claw-guard");
            Store = new GuardStore(dir);
            Store.Load();
            Geo = new GeoService(dir, _log);
            var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
            Engine = new GuardEngine(this, Store, cfg.ToRules());
            Engine.Sweep();

            _sessions.AuthenticationFailed += OnAuthFailed;
            _sessions.AuthenticationSucceeded += OnAuthSucceeded;
            _config.ConfigurationUpdated += OnServerConfigUpdated;

            _tailer = new LogTailer(Path.Combine(_config.ApplicationPaths.LogDirectoryPath, "embyserver.txt"));
            try { _tailer.Poll(); TailStatus = "following " + _tailer.Path; } catch (Exception ex) { TailStatus = "cannot read log: " + ex.Message; }
            _tailTimer = new Timer(_ => Tail(), null, 2000, 2000);
            _sweepTimer = new Timer(_ => { try { Engine.Sweep(); SyncFilter(); Purge(); } catch (Exception ex) { _log.ErrorException("Guard sweep", ex); } }, null, 15000, 60000);
            _geoTimer = new Timer(_ => RefreshGeo(false), null, 5000, (int)TimeSpan.FromHours(24).TotalMilliseconds);
            SyncFilter();
            _log.Info("Guard started: {0} active bans, filter {1}", Store.ActiveBans(Now).Count(), FilterState);
        }

        public void Dispose()
        {
            _sessions.AuthenticationFailed -= OnAuthFailed;
            _sessions.AuthenticationSucceeded -= OnAuthSucceeded;
            _config.ConfigurationUpdated -= OnServerConfigUpdated;
            _tailTimer?.Dispose(); _sweepTimer?.Dispose(); _geoTimer?.Dispose();
            try { Store?.Save(); } catch { }
            if (Instance == this) Instance = null;
        }

        /// <summary>Plugin settings saved.</summary>
        public void ApplyConfiguration()
        {
            var cfg = Plugin.Instance?.Configuration;
            if (cfg == null || Engine == null) return;
            Engine.UpdateRules(cfg.ToRules()); // fires OnBansChanged -> SyncFilter
            RefreshGeo(false);
        }

        public void RefreshGeo(bool force)
        {
            var cfg = Plugin.Instance?.Configuration;
            Geo?.Refresh(cfg?.MaxMindAccountId, cfg?.MaxMindLicenseKey, force);
        }

        public Retention.Info Retention => Core.Retention.FromConfig(_config.Configuration);

        private void Purge()
        {
            var r = Retention;
            if (r.Days > 0) Store.PurgeEvents(r.Days, Now);
        }

        // ---------------- events ----------------
        private void OnAuthFailed(object sender, GenericEventArgs<AuthenticationRequest> e)
        {
            try
            {
                var r = e?.Argument;
                if (r == null) return;
                Engine.OnAuth(new AuthAttempt
                {
                    Ip = r.RemoteAddress?.ToString(), Username = r.Username,
                    Client = string.IsNullOrEmpty(r.AppVersion) ? r.App : r.App + " " + r.AppVersion, Device = r.DeviceName
                });
            }
            catch (Exception ex) { _log.ErrorException("Guard: AuthenticationFailed handler", ex); }
        }

        private void OnAuthSucceeded(object sender, GenericEventArgs<AuthenticationResult> e)
        {
            try
            {
                var s = e?.Argument?.SessionInfo;
                if (s == null) return;
                Engine.OnAuth(new AuthAttempt
                {
                    Ip = s.RemoteEndPoint?.ToString(), Username = e.Argument.User?.Name ?? s.UserName,
                    Client = s.Client, Device = s.DeviceName, Success = true
                });
            }
            catch (Exception ex) { _log.ErrorException("Guard: AuthenticationSucceeded handler", ex); }
        }

        /// <summary>Import the existing embyserver*.txt logs (current + rotated). The live tail is paused meanwhile.</summary>
        public ImportResult ImportLogs()
        {
            var spins = 0;
            while (Interlocked.Exchange(ref _tailBusy, 1) == 1) { Thread.Sleep(50); if (++spins > 400) return new ImportResult { Error = "log watcher busy, try again" }; }
            try
            {
                try { TailCore(); } catch { }
                var files = LogImporter.FindLogs(_config.ApplicationPaths.LogDirectoryPath);
                var scan = LogImporter.Scan(files);
                var res = GuardImport.Run(Engine, scan);
                _log.Info("Guard: imported {0} of {1} log items from {2} files ({3} new bans)", res.Imported, res.Found, res.Files, res.NewBans);
                SyncFilter();
                return res;
            }
            catch (Exception ex) { _log.ErrorException("Guard import", ex); return new ImportResult { Error = ex.Message }; }
            finally { Interlocked.Exchange(ref _tailBusy, 0); }
        }

        private void Tail()
        {
            if (Interlocked.Exchange(ref _tailBusy, 1) == 1) return;
            try { TailCore(); }
            catch (Exception ex) { TailStatus = "log read error: " + ex.Message; }
            finally { Interlocked.Exchange(ref _tailBusy, 0); }
        }

        private void TailCore()
        {
            {
                foreach (var raw in _tailer.Poll())
                {
                    var l = LogLineParser.Parse(raw);
                    if (l == null) continue;
                    LastTailLine = DateTimeOffset.Now;
                    // A failed password is reported by AuthenticationFailed already: don't count it twice.
                    if (l.IsSigninEndpoint && l.Status == 401) continue;
                    Engine.OnApiFailure(new ApiFailure
                    {
                        Ip = l.Ip, Status = l.Status, Method = l.Method, Path = l.Path, IsSigninEndpoint = l.IsSigninEndpoint,
                        Time = l.LocalTime == default ? (DateTimeOffset?)null : new DateTimeOffset(l.LocalTime)
                    });
                }
                if (!TailStatus.StartsWith("following")) TailStatus = "following " + _tailer.Path;
            }
        }

        private void OnServerConfigUpdated(object sender, EventArgs e)
        {
            if (_syncing) return;
            SyncFilter(); // an admin edited the Network page: re-merge (their entries are kept as manual)
        }

        // ---------------- Emby Remote IP filter ----------------
        public void SyncFilter()
        {
            lock (_syncLock)
            {
                if (Engine == null) return;
                try
                {
                    var c = _config.Configuration;
                    var o = FilterSync.Compute(new FilterSync.Input
                    {
                        Current = c.RemoteIPFilter ?? new string[0],
                        CurrentIsBlacklist = c.IsRemoteIPFilterBlacklist,
                        Owned = Store.Data.OwnedFilterEntries,
                        OriginalBlacklistMode = Store.Data.OriginalBlacklistMode,
                        Desired = Engine.DesiredFilterEntries(),
                        Enabled = Engine.Rules.Enabled
                    });
                    FilterState = o.State; ManualFilterCount = o.ManualCount;
                    if (o.State == "conflict-whitelist") _log.Warn("Guard: Emby's Remote IP filter is an allow-list with {0} entries; Guard will not flip it to blacklist. Bans are logged but not enforced.", o.ManualCount);
                    if (o.Changed)
                    {
                        c.RemoteIPFilter = o.NewFilter;
                        c.IsRemoteIPFilterBlacklist = o.NewIsBlacklist;
                        _syncing = true;
                        try { _config.SaveConfiguration(); } finally { _syncing = false; }
                    }
                    Store.Data.OwnedFilterEntries = o.NewOwned;
                    Store.Data.OriginalBlacklistMode = o.NewOriginalBlacklistMode;
                    Store.Save();
                }
                catch (Exception ex) { FilterState = "error: " + ex.Message; _log.ErrorException("Guard: filter sync", ex); }
            }
        }

        // ---------------- IGuardHost ----------------
        public DateTimeOffset Now => DateTimeOffset.UtcNow;

        public bool IsLocal(IPAddress ip)
        {
            var subnets = _config.Configuration.LocalNetworkSubnets ?? new string[0];
            if (subnets.Any(s => IpUtil.InCidr(ip, s))) return true;
            try { return _network.IsInLocalNetwork(ip); } catch { return false; }
        }

        public bool? UserExists(string username)
        {
            if (string.IsNullOrWhiteSpace(username)) return null;
            try { return _users.GetUserByName(username.Trim()) != null; } catch { return null; }
        }

        public string Country(IPAddress ip) => Geo?.Country(ip);

        public void OnBansChanged() => SyncFilter();

        public void OnBan(BanRecord b)
        {
            var len = b.Expires == null ? "permanently" : "for " + GuardEngine.DurationText(b.Expires.Value - b.Created);
            var who = b.Usernames.Count > 0 ? " Usernames tried: " + string.Join(", ", b.Usernames) + "." : "";
            var where = string.IsNullOrEmpty(b.Country) ? "" : " (" + b.Country + ")";
            _log.Info("Guard: banned {0} {1}: {2}", b.Key, len, b.Reason);
            try
            {
                _notifications.SendNotification(new global::Emby.Notifications.NotificationRequest
                {
                    EventId = GuardNotifications.BanEventId,
                    Title = "Guard banned " + b.Key + where,
                    Description = "Banned " + len + ". Reason: " + b.Reason + "." + who + (FilterState == "enforcing" ? "" : " Note: not enforced (" + FilterState + ")."),
                    Date = DateTimeOffset.UtcNow,
                    Severity = LogSeverity.Warn
                });
            }
            catch (Exception ex) { _log.ErrorException("Guard: notification failed", ex); }
        }
    }
}
