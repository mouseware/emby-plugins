using System;
using System.Threading;
using System.Collections.Generic;
using System.Linq;
using System.Net;

namespace Claw.Emby.Guard.Core
{
    /// <summary>What the engine needs from Emby (faked in tests).</summary>
    public interface IGuardHost
    {
        DateTimeOffset Now { get; }
        /// <summary>Emby's own LAN test (LocalNetworkSubnets / RFC1918). Combined with IpUtil.IsAlwaysSafe.</summary>
        bool IsLocal(IPAddress ip);
        /// <summary>null = unknown (lookup failed).</summary>
        bool? UserExists(string username);
        /// <summary>ISO country code or null (no GeoLite DB).</summary>
        string Country(IPAddress ip);
        void OnBan(BanRecord ban);
        /// <summary>Bans changed: push to Emby's Remote IP filter.</summary>
        void OnBansChanged();
    }

    public class AuthAttempt
    {
        public string Ip { get; set; }
        public string Username { get; set; }
        public string Client { get; set; }
        public string Device { get; set; }
        public bool Success { get; set; }
        public bool Forbidden { get; set; }
        /// <summary>Original time (log import). Null = now.</summary>
        public DateTimeOffset? Time { get; set; }
    }

    public class ApiFailure
    {
        public string Ip { get; set; }
        public int Status { get; set; }
        public string Method { get; set; }
        public string Path { get; set; }
        public DateTimeOffset? Time { get; set; }
        /// <summary>Sign-in endpoint (AuthenticateByName etc): 403 there = forbidden sign-in.</summary>
        public bool IsSigninEndpoint { get; set; }
    }

    public class BanResult
    {
        public bool Ok { get; set; }
        public string Error { get; set; }
        public bool NeedsConfirm { get; set; }
        public BanRecord Ban { get; set; }
    }

    /// <summary>
    /// The rules engine. Thread-safe (single lock). Pure logic: persistence and Emby calls
    /// go through <see cref="GuardStore"/> and <see cref="IGuardHost"/>.
    /// </summary>
    public class GuardEngine
    {
        private readonly object _lock = new object();
        private readonly IGuardHost _host;
        private readonly GuardStore _store;
        private GuardRules _rules;
        // Sliding windows of failure times per (category|key).
        private readonly Dictionary<string, List<DateTimeOffset>> _windows = new Dictionary<string, List<DateTimeOffset>>();

        public GuardEngine(IGuardHost host, GuardStore store, GuardRules rules)
        {
            _host = host; _store = store; _rules = Sanitize(rules);
        }

        public GuardRules Rules { get { lock (_lock) return _rules; } }
        public GuardStore Store => _store;

        public void UpdateRules(GuardRules rules)
        {
            bool changed;
            lock (_lock)
            {
                var wasEnabled = _rules.Enabled;
                _rules = Sanitize(rules);
                changed = true; // whitelist / enable may change what is enforced
                // Whitelisted addresses lose their active ban immediately.
                foreach (var b in _store.ActiveBans(_host.Now).ToList())
                {
                    var ip = IpUtil.Parse(b.Ip) ?? IpUtil.Parse(b.Key.Split('/')[0]);
                    if (ip != null && IsWhitelisted(ip)) EndBan(b, "whitelisted");
                }
                _store.Save();
            }
            if (changed) _host.OnBansChanged();
        }

        public static GuardRules Sanitize(GuardRules r)
        {
            r = r ?? new GuardRules();
            int Clamp(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);
            r.SigninFailThreshold = Clamp(r.SigninFailThreshold, 1, 1000);
            r.SigninWindowMinutes = Clamp(r.SigninWindowMinutes, 1, 10080);
            r.UnknownUserFailThreshold = Clamp(r.UnknownUserFailThreshold, 0, 1000);
            r.ApiFailThreshold = Clamp(r.ApiFailThreshold, 1, 100000);
            r.ApiWindowMinutes = Clamp(r.ApiWindowMinutes, 1, 10080);
            r.EscalationResetDays = Clamp(r.EscalationResetDays, 0, 3650);
            r.Ipv6Prefix = Clamp(r.Ipv6Prefix, 16, 128);
            var steps = (r.EscalationMinutes ?? Array.Empty<int>()).Where(x => x >= 0).Select(x => Math.Min(x, 5256000)).ToArray();
            r.EscalationMinutes = steps.Length == 0 ? new[] { 60 } : steps;
            r.InstantBanUsernames = (r.InstantBanUsernames ?? Array.Empty<string>())
                .Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            r.Whitelist = (r.Whitelist ?? Array.Empty<WhitelistEntry>()).Where(w => w != null && IpUtil.TryParseCidr(w.Cidr, out _, out _)).ToArray();
            return r;
        }

        // ---------------- safety ----------------
        public bool IsWhitelisted(IPAddress ip) => _rules.Whitelist.Any(w => IpUtil.InCidr(ip, w.Cidr));

        public bool IsSafe(IPAddress ip)
        {
            if (IpUtil.IsAlwaysSafe(ip)) return true;
            try { return _host.IsLocal(ip); } catch { return false; }
        }

        /// <summary>Why this address can never be banned ("lan", "whitelisted") or null.</summary>
        public string ExemptReason(IPAddress ip)
        {
            if (ip == null) return "invalid";
            if (IsSafe(ip)) return "lan";
            if (IsWhitelisted(ip)) return "whitelisted";
            return null;
        }

        // ---------------- inputs ----------------
        public GuardEvent OnAuth(AuthAttempt a)
        {
            var now = a.Time ?? _host.Now;
            var ip = IpUtil.Parse(a.Ip);
            var key = ip == null ? null : IpUtil.BanKey(ip, _rules.Ipv6Prefix);
            bool? exists = string.IsNullOrWhiteSpace(a.Username) ? (bool?)null : SafeExists(a.Username);
            var ev = new GuardEvent
            {
                Time = now, Ip = ip?.ToString() ?? a.Ip, Key = key, Username = a.Username, UserExists = exists,
                Client = a.Client, Device = a.Device, Country = SafeCountry(ip),
                Kind = a.Success ? EventKinds.SigninOk : (a.Forbidden ? EventKinds.Forbidden : EventKinds.SigninFailed),
                Status = a.Success ? 200 : (a.Forbidden ? 403 : 401)
            };
            BanRecord newBan = null;
            lock (_lock)
            {
                var exempt = ExemptReason(ip);
                var active = key == null ? null : _store.FindActive(key, now);
                if (a.Success)
                {
                    if (key != null) { _windows.Remove("signin|" + key); _windows.Remove("unknown|" + key); }
                    ev.Note = exempt ?? (active != null ? "banned" : "");
                }
                else if (exempt != null) { ev.Note = exempt; ev.Count = key == null ? 0 : Bump("signin|" + key, now, _rules.SigninWindowMinutes); }
                else if (active != null) { active.Hits++; ev.Note = "banned"; ev.Kind = a.Forbidden ? ev.Kind : ev.Kind; AddUser(active, a.Username); }
                else if (_rules.Enabled)
                {
                    var n = Bump("signin|" + key, now, _rules.SigninWindowMinutes);
                    ev.Count = n;
                    string rule = null;
                    var uname = (a.Username ?? "").Trim();
                    bool instantListed = uname.Length > 0 && _rules.InstantBanUsernames.Any(x => string.Equals(x, uname, StringComparison.OrdinalIgnoreCase));
                    // Instant list only bites for names that are NOT real Emby users (a real "guest" mistyping never self-bans).
                    if (instantListed && exists != true) rule = "instant-username";
                    else if (exists == false && _rules.BanUnknownUsersInstantly) rule = "unknown-username-instant";
                    else if (exists == false && _rules.UnknownUserFailThreshold > 0)
                    {
                        var u = Bump("unknown|" + key, now, _rules.SigninWindowMinutes);
                        if (u >= _rules.UnknownUserFailThreshold) rule = "unknown-username";
                    }
                    if (rule == null && n >= _rules.SigninFailThreshold) rule = a.Forbidden ? "forbidden" : "signin-failures";
                    if (rule != null)
                    {
                        newBan = AutoBan(key, ip, rule, now, a.Username);
                        ev.Note = "banned"; ev.Rule = rule;
                    }
                }
                _store.AddEvent(ev);
                if (newBan != null) _store.AddEvent(BanEvent(newBan, now));
                _store.Save();
            }
            if (newBan != null) Fire(newBan);
            return ev;
        }

        public GuardEvent OnApiFailure(ApiFailure f)
        {
            var now = f.Time ?? _host.Now;
            var ip = IpUtil.Parse(f.Ip);
            if (ip == null) return null;
            var key = IpUtil.BanKey(ip, _rules.Ipv6Prefix);
            if (f.IsSigninEndpoint && f.Status == 403)
                return OnAuth(new AuthAttempt { Ip = ip.ToString(), Forbidden = true, Client = f.Method + " " + f.Path, Time = f.Time });
            var ev = new GuardEvent
            {
                Time = now, Ip = ip.ToString(), Key = key, Country = SafeCountry(ip), Status = f.Status,
                Kind = f.Status == 403 ? EventKinds.Api403 : EventKinds.Api401, Request = (f.Method + " " + f.Path).Trim()
            };
            BanRecord newBan = null;
            lock (_lock)
            {
                var exempt = ExemptReason(ip);
                var active = _store.FindActive(key, now);
                if (exempt != null) ev.Note = exempt;
                else if (active != null) { active.Hits++; ev.Note = "blocked"; ev.Kind = EventKinds.Blocked; }
                else if (_rules.Enabled && _rules.WatchApiFailures)
                {
                    var n = Bump("api|" + key, now, _rules.ApiWindowMinutes);
                    ev.Count = n;
                    if (n >= _rules.ApiFailThreshold)
                    {
                        newBan = AutoBan(key, ip, "api-failures", now, null);
                        ev.Note = "banned"; ev.Rule = "api-failures";
                    }
                }
                _store.AddEvent(ev);
                if (newBan != null) _store.AddEvent(BanEvent(newBan, now));
                _store.Save();
            }
            if (newBan != null) Fire(newBan);
            return ev;
        }

        // ---------------- bans ----------------
        /// <summary>Next ban length (minutes, 0 = permanent) and step index for this key.</summary>
        public (int minutes, int step) NextDuration(string key, DateTimeOffset now)
        {
            // Chain: the next step follows the most recent automatic ban for this key if it ended less than
            // EscalationResetDays ago (0 = never reset). Otherwise start again at step 1.
            var last = _store.Bans.Where(b => b.Key == key && !b.Manual).OrderByDescending(b => b.Created).FirstOrDefault();
            int step = 0;
            if (last != null)
            {
                var ended = last.Ended ?? last.Expires ?? now;
                if (_rules.EscalationResetDays == 0 || ended >= now.AddDays(-_rules.EscalationResetDays)) step = last.Step + 1;
            }
            step = Math.Min(step, _rules.EscalationMinutes.Length - 1);
            return (_rules.EscalationMinutes[step], step);
        }

        private BanRecord AutoBan(string key, IPAddress ip, string rule, DateTimeOffset now, string username)
        {
            var (minutes, step) = NextDuration(key, now);
            var b = new BanRecord
            {
                Key = key, Ip = ip.ToString(), Created = now, Expires = minutes == 0 ? (DateTimeOffset?)null : now.AddMinutes(minutes),
                Rule = rule, Reason = RuleText(rule), Step = step, Country = SafeCountry(ip)
            };
            AddUser(b, username);
            _store.Bans.Add(b);
            _windows.Remove("signin|" + key); _windows.Remove("unknown|" + key); _windows.Remove("api|" + key);
            return b;
        }

        public static string RuleText(string rule)
        {
            switch (rule)
            {
                case "instant-username": return "Instant-ban username";
                case "unknown-username": return "Nonexistent username";
                case "unknown-username-instant": return "Nonexistent username (instant)";
                case "signin-failures": return "Too many failed sign-ins";
                case "forbidden": return "Too many forbidden sign-ins";
                case "api-failures": return "Too many failed API calls (401/403)";
                case "manual": return "Manual";
                default: return rule;
            }
        }

        /// <summary>Manual ban from the UI. minutes 0 = permanent. Refuses LAN/whitelisted; asks to confirm the caller's own address.</summary>
        public BanResult ManualBan(string ipOrCidr, int minutes, string reason, string requesterIp, bool confirm)
        {
            var now = _host.Now;
            if (!IpUtil.TryParseCidr(ipOrCidr, out var net, out var prefix)) return new BanResult { Error = "Not an IP address or CIDR: " + ipOrCidr };
            var single = (net.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && prefix == 32) || prefix == 128;
            var key = single ? IpUtil.BanKey(net, _rules.Ipv6Prefix) : net + "/" + prefix;
            var probe = IpUtil.Parse(ipOrCidr.Split('/')[0]) ?? net;
            BanRecord b;
            lock (_lock)
            {
                if (IsSafe(probe) || IsSafe(net)) return new BanResult { Error = probe + " is a LAN/private/loopback address. Emby never filters those, so Guard never bans them." };
                if (IsWhitelisted(probe)) return new BanResult { Error = probe + " is on the whitelist. Remove it from the whitelist first." };
                var req = IpUtil.Parse(requesterIp);
                if (req != null && IpUtil.InCidr(req, key.Contains("/") ? key : key + (req.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? "/32" : "/128")) && !confirm)
                    return new BanResult { NeedsConfirm = true, Error = "This is the address you are using right now (" + req + "). Banning it will lock this browser out of Emby." };
                var existing = _store.FindActive(key, now);
                if (existing != null) EndBan(existing, "replaced");
                b = new BanRecord
                {
                    Key = key, Ip = probe.ToString(), Created = now, Expires = minutes <= 0 ? (DateTimeOffset?)null : now.AddMinutes(minutes),
                    Rule = "manual", Reason = string.IsNullOrWhiteSpace(reason) ? "Manual" : reason.Trim(), Manual = true, Country = SafeCountry(probe)
                };
                if (existing != null) { b.Usernames.AddRange(existing.Usernames); b.Hits = existing.Hits; }
                _store.Bans.Add(b);
                _store.AddEvent(BanEvent(b, now));
                _store.Save();
            }
            Fire(b);
            return new BanResult { Ok = true, Ban = b };
        }

        public bool Unban(string key)
        {
            lock (_lock)
            {
                var b = _store.FindActive(key, _host.Now);
                if (b == null) return false;
                EndBan(b, "unbanned");
                _store.AddEvent(new GuardEvent { Time = _host.Now, Kind = EventKinds.Unbanned, Ip = b.Ip, Key = b.Key, Country = b.Country, Note = "unbanned" });
                _store.Save();
            }
            _host.OnBansChanged();
            return true;
        }

        /// <summary>minutes 0 = make permanent; otherwise push expiry to now+minutes (or current expiry+minutes when later).</summary>
        public bool Extend(string key, int minutes)
        {
            lock (_lock)
            {
                var now = _host.Now;
                var b = _store.FindActive(key, now);
                if (b == null) return false;
                if (minutes <= 0) b.Expires = null;
                else if (b.Expires != null) b.Expires = (b.Expires > now ? b.Expires.Value : now).AddMinutes(minutes);
                _store.Save();
            }
            _host.OnBansChanged();
            return true;
        }

        /// <summary>Lift expired bans. Returns how many ended.</summary>
        public int Sweep()
        {
            int n = 0;
            lock (_lock)
            {
                var now = _host.Now;
                foreach (var b in _store.Bans.Where(b => b.Ended == null && b.Expires != null && b.Expires <= now).ToList())
                {
                    EndBan(b, "expired"); b.Ended = b.Expires; n++;
                    _store.AddEvent(new GuardEvent { Time = now, Kind = EventKinds.Unbanned, Ip = b.Ip, Key = b.Key, Country = b.Country, Note = "expired" });
                }
                // windows: drop stale entries
                foreach (var k in _windows.Keys.ToList())
                {
                    var l = _windows[k]; l.RemoveAll(t => t < now.AddDays(-7));
                    if (l.Count == 0) _windows.Remove(k);
                }
                if (n > 0) _store.Save();
            }
            if (n > 0) _host.OnBansChanged();
            return n;
        }

        /// <summary>Keys Guard wants in Emby's blacklist (empty when disabled).</summary>
        public List<string> DesiredFilterEntries()
        {
            lock (_lock)
            {
                if (!_rules.Enabled) return new List<string>();
                return _store.ActiveBans(_host.Now).Select(b => b.Key).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            }
        }

        public bool AddInstantUsername(string name)
        {
            name = (name ?? "").Trim();
            if (name.Length == 0) return false;
            lock (_lock)
            {
                if (_rules.InstantBanUsernames.Any(x => string.Equals(x, name, StringComparison.OrdinalIgnoreCase))) return false;
                _rules.InstantBanUsernames = _rules.InstantBanUsernames.Concat(new[] { name }).ToArray();
                return true;
            }
        }

        // ---------------- helpers ----------------
        private void EndBan(BanRecord b, string why) { b.Ended = _host.Now; b.EndReason = why; }

        private static void AddUser(BanRecord b, string u)
        {
            if (string.IsNullOrWhiteSpace(u)) return;
            if (!b.Usernames.Any(x => string.Equals(x, u, StringComparison.OrdinalIgnoreCase)) && b.Usernames.Count < 20) b.Usernames.Add(u);
        }

        private int Bump(string k, DateTimeOffset now, int windowMinutes)
        {
            if (!_windows.TryGetValue(k, out var l)) _windows[k] = l = new List<DateTimeOffset>();
            l.Add(now);
            var from = now.AddMinutes(-windowMinutes);
            l.RemoveAll(t => t <= from);
            return l.Count;
        }

        private GuardEvent BanEvent(BanRecord b, DateTimeOffset now) => new GuardEvent
        {
            Time = now, Kind = EventKinds.Banned, Ip = b.Ip, Key = b.Key, Country = b.Country, Rule = b.Rule,
            Username = b.Usernames.FirstOrDefault(), Note = b.Expires == null ? "permanent" : DurationText(b.Expires.Value - b.Created)
        };

        public static string DurationText(TimeSpan t)
        {
            if (t.TotalDays >= 1 && Math.Abs(t.TotalDays - Math.Round(t.TotalDays)) < 0.01) return Math.Round(t.TotalDays) + " d";
            if (t.TotalHours >= 1 && Math.Abs(t.TotalHours - Math.Round(t.TotalHours)) < 0.01) return Math.Round(t.TotalHours) + " h";
            return Math.Max(1, Math.Round(t.TotalMinutes)) + " min";
        }

        // Quiet mode (log import): no per-ban notification and no filter sync per ban; the caller syncs once at the end.
        private int _quiet;
        public int QuietBans { get; private set; }
        public T RunQuiet<T>(Func<T> f)
        {
            Interlocked.Increment(ref _quiet); QuietBans = 0;
            try { return f(); } finally { Interlocked.Decrement(ref _quiet); }
        }

        private void Fire(BanRecord b)
        {
            if (Volatile.Read(ref _quiet) > 0) { QuietBans++; return; }
            try { _host.OnBansChanged(); } catch { }
            try { if (_rules.NotifyOnBan) _host.OnBan(b); } catch { }
        }

        private bool? SafeExists(string u) { try { return _host.UserExists(u); } catch { return null; } }
        private string SafeCountry(IPAddress ip) { try { return ip == null ? null : _host.Country(ip); } catch { return null; } }
    }
}
