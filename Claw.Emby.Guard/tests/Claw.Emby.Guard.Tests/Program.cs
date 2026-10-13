using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using Claw.Emby.Guard.Core;

class FakeHost : IGuardHost
{
    public DateTimeOffset Now { get; set; } = new DateTimeOffset(2026, 10, 13, 12, 0, 0, TimeSpan.Zero);
    public HashSet<string> Users = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "bob", "carol", "guest", "alice" };
    public List<string> LocalSubnets = new List<string>();
    public List<BanRecord> Notified = new List<BanRecord>();
    public int Changes;
    public Func<IPAddress, string> Geo = ip => null;
    public bool IsLocal(IPAddress ip) => LocalSubnets.Any(s => IpUtil.InCidr(ip, s));
    public bool? UserExists(string u) => Users.Contains(u);
    public string Country(IPAddress ip) => Geo(ip);
    public void OnBan(BanRecord b) => Notified.Add(b);
    public void OnBansChanged() => Changes++;
}

static class Program
{
    static int fails, passes;
    static void Ok(bool c, string m) { if (c) passes++; else fails++; Console.WriteLine((c ? "PASS " : "FAIL ") + m); }
    static string Tmp() { var d = Path.Combine(Path.GetTempPath(), "guardtest-" + Guid.NewGuid().ToString("N")); return d; }
    static (GuardEngine e, FakeHost h, GuardStore s, string dir) New(GuardRules r = null)
    {
        var dir = Tmp(); var s = new GuardStore(dir); s.Load(); var h = new FakeHost();
        return (new GuardEngine(h, s, r ?? new GuardRules()), h, s, dir);
    }
    static void Fail(GuardEngine e, string ip, string user, int n = 1) { for (int i = 0; i < n; i++) e.OnAuth(new AuthAttempt { Ip = ip, Username = user, Client = "Emby Web", Device = "Chrome" }); }

    static int Main(string[] args)
    {
        if (args.Length > 1 && args[0] == "--scan")
        {
            // Dry run against real logs: counts only, nothing written outside a temp folder, no IPs printed.
            var files = LogImporter.FindLogs(args[1]);
            var scan = LogImporter.Scan(files);
            Console.WriteLine($"files {scan.Files}, lines {scan.Lines}, items {scan.Items.Count}");
            foreach (var g in scan.Items.GroupBy(x => x.Kind)) Console.WriteLine($"  {g.Key}: {g.Count()} ({g.Select(x => x.Ip).Distinct().Count()} distinct IPs)");
            Console.WriteLine($"  sign-ins with username: {scan.Items.Count(x => x.Kind == LogImporter.ItemKind.SigninFailed && x.Username != null)}");
            var (e, h, s, dir) = New(); h.Now = DateTimeOffset.Now;
            var r = GuardImport.Run(e, scan);
            Console.WriteLine($"import (temp store): imported {r.Imported}, LAN {r.LanOrWhitelisted}, new bans {r.NewBans}, still active {r.StillActiveBans}, period {r.From:yyyy-MM-dd HH:mm} .. {r.To:yyyy-MM-dd HH:mm}");
            foreach (var g in s.Bans.GroupBy(b => b.Rule)) Console.WriteLine($"  bans by rule {g.Key}: {g.Count()}");
            var r2 = GuardImport.Run(e, scan);
            Console.WriteLine($"second run: imported {r2.Imported}, already {r2.AlreadyImported}");
            Directory.Delete(dir, true);
            return 0;
        }
        // ---------- IP utils ----------
        Ok(IpUtil.Parse("::ffff:203.0.113.9").ToString() == "203.0.113.9", "IPv4-mapped IPv6 normalised");
        Ok(IpUtil.Parse("\u200C\u200D\u200D203.0.113.9\u200C").ToString() == "203.0.113.9", "invisible log marks stripped");
        Ok(IpUtil.Parse("[2001:db8::5]:8920").ToString() == "2001:db8::5", "bracketed v6 with port");
        Ok(IpUtil.Parse("203.0.113.9:443").ToString() == "203.0.113.9", "v4 with port");
        Ok(IpUtil.BanKey(IpUtil.Parse("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), 64) == "2001:db8:1:2::/64", "IPv6 ban key /64");
        Ok(IpUtil.BanKey(IpUtil.Parse("2001:db8:1:2::9"), 128) == "2001:db8:1:2::9", "IPv6 prefix 128 = single address");
        Ok(IpUtil.BanKey(IpUtil.Parse("::ffff:198.51.100.7"), 64) == "198.51.100.7", "mapped v6 bans as v4");
        foreach (var lan in new[] { "127.0.0.1", "::1", "10.1.2.3", "172.20.1.1", "192.168.1.44", "169.254.3.3", "100.101.102.103", "fd00::1", "fe80::1", "::ffff:192.168.1.5" })
            Ok(IpUtil.IsAlwaysSafe(IpUtil.Parse(lan)), "always safe: " + lan);
        Ok(!IpUtil.IsAlwaysSafe(IpUtil.Parse("198.51.100.68")), "public v4 not safe");
        Ok(IpUtil.InCidr(IpUtil.Parse("203.0.113.77"), "203.0.113.0/24") && !IpUtil.InCidr(IpUtil.Parse("203.0.114.1"), "203.0.113.0/24"), "CIDR match");
        Ok(IpUtil.InCidr(IpUtil.Parse("203.0.113.77"), "203.0.113.0/255.255.255.0"), "dotted netmask");

        // ---------- rules: threshold + escalation ----------
        {
            var (e, h, s, dir) = New();
            Fail(e, "198.51.100.10", "bob", 4);
            Ok(!s.ActiveBans(h.Now).Any(), "4 failures (real user): no ban yet");
            Fail(e, "198.51.100.10", "bob");
            var b = s.FindActive("198.51.100.10", h.Now);
            Ok(b != null && b.Rule == "signin-failures" && (b.Expires - b.Created) == TimeSpan.FromHours(1) && b.Step == 0, "5th failure in 10 min: 1 h ban");
            Ok(h.Notified.Count == 1 && h.Changes >= 1, "one notification + filter sync per ban");
            Ok(b.Usernames.Contains("bob"), "ban records username tried");
            // window: failures spread beyond 10 min don't add up
            Fail(e, "198.51.100.11", "carol", 4); h.Now = h.Now.AddMinutes(11); Fail(e, "198.51.100.11", "carol");
            Ok(s.FindActive("198.51.100.11", h.Now) == null, "failures older than the window drop out");
            // escalate: after expiry, next offence 1 d, then 30 d, then permanent
            h.Now = h.Now.AddHours(2); Ok(e.Sweep() == 1 && s.FindActive("198.51.100.10", h.Now) == null, "expiry sweep lifts the 1 h ban");
            Fail(e, "198.51.100.10", "bob", 5); b = s.FindActive("198.51.100.10", h.Now);
            Ok(b != null && b.Expires - b.Created == TimeSpan.FromDays(1) && b.Step == 1, "2nd offence: 1 day");
            h.Now = h.Now.AddDays(2); e.Sweep(); Fail(e, "198.51.100.10", "bob", 5); b = s.FindActive("198.51.100.10", h.Now);
            Ok(b != null && b.Expires - b.Created == TimeSpan.FromDays(30), "3rd offence: 30 days");
            h.Now = h.Now.AddDays(31); e.Sweep(); Fail(e, "198.51.100.10", "bob", 5); b = s.FindActive("198.51.100.10", h.Now);
            Ok(b != null && b.Expires == null, "4th offence: permanent " + (b==null?"null":b.Step+" "+b.Expires));
            Fail(e, "198.51.100.10", "bob"); Ok(b.Hits == 1, "attempts while banned counted as hits, no new ban");
            // persistence across restart
            var s2 = new GuardStore(dir); s2.Load();
            Ok(s2.FindActive("198.51.100.10", h.Now) != null && s2.FindActive("198.51.100.10", h.Now).Expires == null, "bans persist across restart");
            Ok(s2.ReadEvents(null, null, 1000).Count(x => x.Kind == EventKinds.Banned) == 4, "ban events persisted to the daily log");
            Ok(s2.Recent(0, 10).Count > 0, "live log warmed from disk on startup");
            Directory.Delete(dir, true);
        }
        {   // escalation reset window
            var (e, h, s, dir) = New(new GuardRules { EscalationResetDays = 30 });
            Fail(e, "198.51.100.20", "bob", 5); h.Now = h.Now.AddDays(40); e.Sweep();
            Fail(e, "198.51.100.20", "bob", 5);
            var b = s.FindActive("198.51.100.20", h.Now);
            Ok(b != null && b.Step == 0, "offence older than reset window: back to step 1");
            Directory.Delete(dir, true);
        }
        {   // customised steps + thresholds
            var (e, h, s, dir) = New(new GuardRules { SigninFailThreshold = 3, SigninWindowMinutes = 5, EscalationMinutes = new[] { 15, 0 } });
            Fail(e, "198.51.100.30", "bob", 3); var b = s.FindActive("198.51.100.30", h.Now);
            Ok(b != null && b.Expires - b.Created == TimeSpan.FromMinutes(15), "custom: 3 fails -> 15 min");
            h.Now = h.Now.AddMinutes(20); e.Sweep(); Fail(e, "198.51.100.30", "bob", 3);
            Ok(s.FindActive("198.51.100.30", h.Now).Expires == null, "custom: 2nd step permanent");
            Directory.Delete(dir, true);
        }

        // ---------- instant-ban usernames / nonexistent users ----------
        {
            var (e, h, s, dir) = New();
            Fail(e, "203.0.113.50", "Administrator");
            var b = s.FindActive("203.0.113.50", h.Now);
            Ok(b != null && b.Rule == "instant-username", "instant-ban username (case-insensitive) bans on first try");
            Fail(e, "203.0.113.51", "guest");
            Ok(s.FindActive("203.0.113.51", h.Now) == null, "instant list skips names that are real Emby users (guest exists here)");
            Fail(e, "203.0.113.52", "nosuchperson");
            Ok(s.FindActive("203.0.113.52", h.Now) == null, "nonexistent username: 1st try no ban");
            Fail(e, "203.0.113.52", "otherghost");
            b = s.FindActive("203.0.113.52", h.Now);
            Ok(b != null && b.Rule == "unknown-username", "nonexistent username: 2nd try bans (default 2)");
            var ev = s.Recent(0, 50).First(x => x.Ip == "203.0.113.52" && x.Kind == EventKinds.SigninFailed);
            Ok(ev.UserExists == false, "event tags 'no such user'");
            Ok(e.AddInstantUsername("bob2") && e.Rules.InstantBanUsernames.Contains("bob2") && !e.AddInstantUsername("BOB2"), "watch username adds to the instant list once");
            Directory.Delete(dir, true);
        }
        {
            var (e, h, s, dir) = New(new GuardRules { UnknownUserFailThreshold = 0 });
            Fail(e, "203.0.113.60", "ghost", 4);
            Ok(s.FindActive("203.0.113.60", h.Now) == null, "unknown-user rule 0 = off (normal threshold applies)");
            Directory.Delete(dir, true);
        }

        // ---------- whitelist + LAN safety ----------
        {
            var (e, h, s, dir) = New(new GuardRules { Whitelist = new[] { new WhitelistEntry { Cidr = "198.51.100.0/24", Note = "work" } } });
            Fail(e, "198.51.100.99", "root", 10);
            Ok(s.FindActive("198.51.100.99", h.Now) == null, "whitelisted address never auto-banned");
            Ok(s.Recent(0, 1)[0].Note == "whitelisted", "log row marked whitelisted");
            Fail(e, "192.168.1.44", "root", 10); Fail(e, "::1", "admin", 10); Fail(e, "::ffff:10.0.0.5", "admin", 10);
            Ok(!s.ActiveBans(h.Now).Any(), "LAN / loopback / mapped-LAN never banned");
            h.LocalSubnets.Add("203.0.113.0/24");
            Fail(e, "203.0.113.5", "root");
            Ok(s.FindActive("203.0.113.5", h.Now) == null, "Emby LocalNetworkSubnets respected");
            var r = e.ManualBan("192.168.1.10", 60, null, null, true);
            Ok(!r.Ok && r.Error.Contains("LAN"), "manual ban of LAN refused");
            r = e.ManualBan("198.51.100.4", 60, null, null, true);
            Ok(!r.Ok && r.Error.Contains("whitelist"), "manual ban of whitelisted refused");
            // whitelisting lifts an existing ban
            var r2 = e.ManualBan("203.0.114.9", 0, "test", null, false);
            Ok(r2.Ok && r2.Ban.Expires == null && r2.Ban.Manual, "manual permanent ban");
            var rules = e.Rules; rules.Whitelist = rules.Whitelist.Concat(new[] { new WhitelistEntry { Cidr = "203.0.114.9" } }).ToArray(); e.UpdateRules(rules);
            Ok(s.FindActive("203.0.114.9", h.Now) == null, "adding to whitelist lifts the active ban");
            Directory.Delete(dir, true);
        }
        {   // own-address confirm
            var (e, h, s, dir) = New();
            var r = e.ManualBan("198.51.100.68", 60, null, "::ffff:198.51.100.68", false);
            Ok(!r.Ok && r.NeedsConfirm, "banning your own address needs confirm");
            r = e.ManualBan("198.51.100.68", 60, null, "198.51.100.68", true);
            Ok(r.Ok, "...and works with confirm");
            r = e.ManualBan("2001:db8:5:6::77", 1440, null, "2001:db8:5:6::1", false);
            Ok(!r.Ok && r.NeedsConfirm, "own IPv6 /64 also needs confirm");
            Ok(e.Extend("198.51.100.68", 0) && s.FindActive("198.51.100.68", h.Now).Expires == null, "make permanent");
            var e2 = e.ManualBan("198.51.100.200", 60, null, null, false); var exp = e2.Ban.Expires;
            Ok(e.Extend("198.51.100.200", 1440) && s.FindActive("198.51.100.200", h.Now).Expires == exp.Value.AddDays(1), "extend by 1 day");
            Ok(e.Unban("198.51.100.200") && s.FindActive("198.51.100.200", h.Now) == null, "unban");
            Ok(s.Bans.Any(b => b.Key == "198.51.100.200" && b.EndReason == "unbanned"), "unban kept in history");
            Directory.Delete(dir, true);
        }
        {   // master off
            var (e, h, s, dir) = New();
            Fail(e, "198.51.100.40", "bob", 5);
            Ok(e.DesiredFilterEntries().SequenceEqual(new[] { "198.51.100.40" }), "desired filter = active bans");
            var r = e.Rules; r.Enabled = false; e.UpdateRules(r);
            Ok(e.DesiredFilterEntries().Count == 0, "disabled: nothing enforced");
            Fail(e, "198.51.100.41", "root", 5);
            Ok(s.FindActive("198.51.100.41", h.Now) == null, "disabled: no new bans (still logged)");
            Directory.Delete(dir, true);
        }

        // ---------- API failures ----------
        {
            var (e, h, s, dir) = New(new GuardRules { ApiFailThreshold = 3, ApiWindowMinutes = 10 });
            for (int i = 0; i < 2; i++) e.OnApiFailure(new ApiFailure { Ip = "198.51.100.50", Status = 401, Method = "GET", Path = "/emby/Users" });
            Ok(s.FindActive("198.51.100.50", h.Now) == null, "2 API 401s: no ban");
            e.OnApiFailure(new ApiFailure { Ip = "198.51.100.50", Status = 403, Method = "GET", Path = "/emby/Plugins" });
            var b = s.FindActive("198.51.100.50", h.Now);
            Ok(b != null && b.Rule == "api-failures", "3rd API failure: banned (api rule)");
            var ev = e.OnApiFailure(new ApiFailure { Ip = "198.51.100.50", Status = 403, Method = "GET", Path = "/emby/System/Info" });
            Ok(ev.Kind == EventKinds.Blocked && b.Hits == 1, "requests while banned logged as blocked");
            for (int i = 0; i < 10; i++) e.OnApiFailure(new ApiFailure { Ip = "::1", Status = 401, Method = "GET", Path = "/emby/x" });
            Ok(!s.ActiveBans(h.Now).Any(x => x.Key == "::1"), "API failures from loopback ignored");
            var f = e.OnApiFailure(new ApiFailure { Ip = "198.51.100.51", Status = 403, Method = "POST", Path = "/emby/Users/AuthenticateByName", IsSigninEndpoint = true });
            Ok(f.Kind == EventKinds.Forbidden, "403 on sign-in endpoint = forbidden sign-in (sign-in rule)");
            var r = e.Rules; r.WatchApiFailures = false; e.UpdateRules(r);
            for (int i = 0; i < 5; i++) e.OnApiFailure(new ApiFailure { Ip = "198.51.100.52", Status = 401, Method = "GET", Path = "/x" });
            Ok(s.FindActive("198.51.100.52", h.Now) == null, "API watching off: no API bans");
            Directory.Delete(dir, true);
        }
        {   // success clears counter; IPv6 prefix grouping; geo
            var (e, h, s, dir) = New();
            h.Geo = ip => ip.ToString().StartsWith("198.51.100.") ? "US" : null;
            Fail(e, "198.51.100.60", "bob", 4);
            e.OnAuth(new AuthAttempt { Ip = "198.51.100.60", Username = "bob", Success = true });
            Fail(e, "198.51.100.60", "bob", 4);
            Ok(s.FindActive("198.51.100.60", h.Now) == null, "successful sign-in resets the failure counter");
            Ok(s.Recent(0, 1)[0].Country == "US", "country stored on events");
            Fail(e, "2001:db8:aa:bb::1", "bob", 3); Fail(e, "2001:db8:aa:bb::2", "bob", 2);
            Ok(s.FindActive("2001:db8:aa:bb::/64", h.Now) != null, "IPv6 failures counted per /64");
            Directory.Delete(dir, true);
        }

        // ---------- filter sync ----------
        {
            var o = FilterSync.Compute(new FilterSync.Input { Current = new string[0], CurrentIsBlacklist = false, Desired = new List<string> { "198.51.100.1" }, Enabled = true });
            Ok(o.Changed && o.NewIsBlacklist && o.NewFilter.SequenceEqual(new[] { "198.51.100.1" }) && o.NewOriginalBlacklistMode == false && o.State == "enforcing", "empty whitelist-mode filter: switched to blacklist with ban");
            var o2 = FilterSync.Compute(new FilterSync.Input { Current = new[] { "5.5.5.5", "198.51.100.1" }, CurrentIsBlacklist = true, Owned = new List<string> { "198.51.100.1" }, OriginalBlacklistMode = false, Desired = new List<string> { "198.51.100.2" }, Enabled = true });
            Ok(o2.NewFilter.SequenceEqual(new[] { "5.5.5.5", "198.51.100.2" }) && o2.NewOwned.SequenceEqual(new[] { "198.51.100.2" }) && o2.ManualCount == 1, "manual entries kept; expired removed; new added");
            var o3 = FilterSync.Compute(new FilterSync.Input { Current = new[] { "5.5.5.5", "198.51.100.2" }, CurrentIsBlacklist = true, Owned = new List<string> { "198.51.100.2" }, Desired = new List<string> { "198.51.100.2" }, Enabled = true });
            Ok(!o3.Changed, "no change: no write");
            var o4 = FilterSync.Compute(new FilterSync.Input { Current = new[] { "5.5.5.5", "198.51.100.2" }, CurrentIsBlacklist = true, Owned = new List<string> { "198.51.100.2" }, OriginalBlacklistMode = false, Enabled = false });
            Ok(o4.NewFilter.SequenceEqual(new[] { "5.5.5.5" }) && o4.NewIsBlacklist && o4.NewOwned.Count == 0 && o4.State == "off", "off switch removes only Guard's entries (manual kept, stays blacklist)");
            var o5 = FilterSync.Compute(new FilterSync.Input { Current = new[] { "198.51.100.2" }, CurrentIsBlacklist = true, Owned = new List<string> { "198.51.100.2" }, OriginalBlacklistMode = false, Enabled = false });
            Ok(o5.NewFilter.Length == 0 && !o5.NewIsBlacklist && o5.NewOriginalBlacklistMode == null, "off switch with nothing manual restores original (whitelist/empty) mode");
            var o6 = FilterSync.Compute(new FilterSync.Input { Current = new[] { "203.0.113.0/24" }, CurrentIsBlacklist = false, Desired = new List<string> { "198.51.100.3" }, Enabled = true });
            Ok(!o6.Changed && o6.State == "conflict-whitelist", "admin allow-list present: Guard refuses to flip it (conflict)");
            var o7 = FilterSync.Compute(new FilterSync.Input { Current = new[] { "198.51.100.9" }, CurrentIsBlacklist = true, Owned = new List<string>(), Desired = new List<string> { "198.51.100.9" }, Enabled = true });
            Ok(!o7.Changed && o7.NewOwned.Count == 0, "ban already present as manual entry: not claimed as owned");
        }

        // ---------- log line parser (real 4.10.1 format) ----------
        {
            var raw = "2026-10-12 12:48:14.289 Info PluginService-0HNP8CJGIATKU:00000059: http/2 Response 403 to \u200C\u200D\u200D198.51.100.70\u200C. Time: 0ms. GET https://\u200C\u200D\u200Dhome.example.com\u200C:8920/emby/Plugins?X-Emby-Client=Emby%20Web&X-Emby-Token=SECRET";
            var l = LogLineParser.Parse(raw);
            Ok(l != null && l.Status == 403 && l.Ip == "198.51.100.70" && l.Method == "GET" && l.Path == "/emby/Plugins" && l.Service == "PluginService", "parses real 403 line");
            Ok(!l.Path.Contains("SECRET"), "query string (token) dropped");
            var raw2 = "2026-10-12 09:24:01.909 Info UserService-0HNP686MUPBON:00000001: http/1.1 Response 401 to \u200C\u200D\u200D::1\u200C. Time: 0ms. GET http://\u200C\u200D\u200Dlocalhost\u200C:8096/emby/Users";
            var l2 = LogLineParser.Parse(raw2);
            Ok(l2 != null && l2.Status == 401 && l2.Ip == "::1", "parses v6 loopback 401");
            var raw3 = "2026-10-13 10:00:00.000 Info UserService-AAA:00000002: http/2 Response 401 to \u200C\u200D\u200D198.51.100.71\u200C. Time: 3ms. POST https://\u200C\u200D\u200Dh\u200C/emby/Users/AuthenticateByName?X-Emby-Client=x";
            Ok(LogLineParser.Parse(raw3).IsSigninEndpoint, "AuthenticateByName flagged as sign-in endpoint");
            Ok(LogLineParser.Parse("2026-10-09 04:17:58.665 Info LibraryMonitor: 401 Unauthorized (E:\\TV\\Mr. Robot - 401 Unauthorized.mkv) will be refreshed.") == null, "file names with 401 ignored");
            Ok(LogLineParser.Parse("2026-10-13 10:00:00.000 Info X-1:2: http/2 Response 404 to \u200C1.2.3.4\u200C. Time: 0ms. GET https://h/x") == null, "404 ignored");
        }

        // ---------- retention ----------
        {
            var info = Retention.FromConfig(new { LogFileRetentionDays = 3 });
            Ok(info.Days == 0 && info.LogFileRetentionDays == 3 && info.Text.StartsWith("Forever"), "no activity retention setting: forever");
            var info2 = Retention.FromConfig(new { ActivityLogRetentionDays = 90 });
            Ok(info2.Days == 90, "future ActivityLogRetentionDays picked up");
            var (e, h, s, dir) = New(); Fail(e, "198.51.100.80", "x"); s.Save();
            File.WriteAllText(Path.Combine(s.EventsDir, "2020-01-01.jsonl"), "");
            Ok(s.PurgeEvents(0, h.Now) == 0 && File.Exists(Path.Combine(s.EventsDir, "2020-01-01.jsonl")), "retention 0 keeps everything");
            Ok(s.PurgeEvents(30, h.Now) == 1, "retention N purges old day files");
            Directory.Delete(dir, true);
        }

        // ---------- log tailer ----------
        {
            var d = Tmp(); Directory.CreateDirectory(d); var f = Path.Combine(d, "embyserver.txt");
            File.WriteAllText(f, "old line 1\nold line 2\n");
            var tl = new LogTailer(f);
            Ok(tl.Poll().Count == 0, "tailer starts at end (no replay)");
            File.AppendAllText(f, "new 1\nnew 2\npartial");
            var got = tl.Poll();
            Ok(got.Count == 2 && got[0] == "new 1" && got[1] == "new 2", "reads appended complete lines only");
            File.AppendAllText(f, " end\n");
            got = tl.Poll(); Ok(got.Count == 1 && got[0] == "partial end", "partial line completed on next poll");
            // rotation: rename + new file
            File.Move(f, Path.Combine(d, "embyserver-123.txt"));
            System.Threading.Thread.Sleep(20);
            File.WriteAllText(f, "after rotate\n"); File.SetCreationTimeUtc(f, DateTime.UtcNow.AddSeconds(5));
            got = tl.Poll(); Ok(got.Count == 1 && got[0] == "after rotate", "follows rotation to the new file");
            using (var hold = new FileStream(f, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
            { var b = System.Text.Encoding.UTF8.GetBytes("while open\n"); hold.Write(b, 0, b.Length); hold.Flush(); got = tl.Poll(); }
            Ok(got.Count == 1, "reads while Emby holds the file open");
            Directory.Delete(d, true);
        }

        // ---------- ban non-existent usernames instantly ----------
        {
            var (e, h, s, dir) = New();
            Fail(e, "198.51.100.80", "nosuchperson");
            Ok(s.FindActive("198.51.100.80", h.Now) == null, "instant-unknown off (default): 1 try with unknown name, no ban");
            Ok(new GuardRules().BanUnknownUsersInstantly == false, "instant-unknown defaults to off");
            var r = new GuardRules { BanUnknownUsersInstantly = true };
            (e, h, s, dir) = New(r);
            Fail(e, "198.51.100.81", "nosuchperson");
            var b = s.FindActive("198.51.100.81", h.Now);
            Ok(b != null && b.Rule == "unknown-username-instant" && b.Expires - b.Created == TimeSpan.FromHours(1), "instant-unknown on: first try bans (1 h step)");
            Fail(e, "198.51.100.82", "bob");
            Ok(s.FindActive("198.51.100.82", h.Now) == null, "instant-unknown on: real user mistyping not banned");
            Fail(e, "192.168.1.70", "nosuchperson"); Fail(e, "::1", "nosuchperson");
            Ok(!s.Bans.Any(x => x.Key == "192.168.1.70" || x.Key == "::1"), "instant-unknown on: LAN/loopback never banned");
            Fail(e, "198.51.100.83", "admin");
            Ok(s.FindActive("198.51.100.83", h.Now)?.Rule == "instant-username", "instant list still applies with its own rule");
        }

        // ---------- import from Emby logs ----------
        {
            string Z(string ip) => "\u200C\u200D\u200D" + ip + "\u200C"; // Emby's marks
            var rot = new List<string>
            {
                "2026-10-12 22:52:02.990 Warn ConnectService-0HNP8CJGIAV1Q:00000002: AUTH-ERROR: " + Z("203.0.113.110") + " - Access token is invalid or expired.",
                "2026-10-12 22:52:02.990 Info ConnectService-0HNP8CJGIAV1Q:00000002: http/1.1 Response 401 to " + Z("203.0.113.110") + ". Time: 1ms. GET https://" + Z("home.example.com") + ":8920/Connect/Exchange?format=json&ConnectUserId=abc&api_key=SECRET. ",
                "2026-10-12 22:52:07.701 Error DefaultAuthenticationProvider: Invalid username or password. No user named admin exists",
                "2026-10-12 22:52:07.703 Warn UserService-0HNP8CJGIAV1Q:00000006: AUTH-ERROR: " + Z("203.0.113.110") + " - Invalid username or password entered.",
                "2026-10-12 22:52:07.704 Info UserService-0HNP8CJGIAV1Q:00000006: http/1.1 Response 401 to " + Z("203.0.113.110") + ". Time: 3ms. POST https://home.example.com:8920/Users/AuthenticateByName. ",
                "2026-10-12 22:52:09.214 Error DefaultAuthenticationProvider: Invalid username or password. No user named admin exists",
                "2026-10-12 22:52:09.214 Warn UserService-0HNP8CJGIAV1Q:00000007: AUTH-ERROR: \u200E\u202A203.0.113.110\u202C - Invalid username or password entered.",
                "2026-10-12 23:10:00.000 Info Something unrelated happened",
                "2026-10-12 09:24:01.866 Warn ActivityLogService-0HNP686MUPBOM:00000001: AUTH-ERROR: ::1 - Access token is invalid or expired.",
                "2026-10-12 09:24:01.867 Info ActivityLogService-0HNP686MUPBOM:00000001: http/1.1 Response 401 to " + Z("::1") + ". Time: 0ms. GET http://localhost:8096/emby/System/ActivityLogEntries",
            };
            var cur = new List<string>();
            for (int i = 0; i < 6; i++)
            {
                cur.Add($"2026-10-13 07:00:0{i}.100 Warn UserService-0HNPAAAA:0000001{i}: AUTH-ERROR: 192.168.1.44 - Invalid username or password entered.");
            }
            cur.Add("2026-10-13 07:30:00.000 Info UserService-0HNPBBBB:00000001: http/2 Response 403 to " + Z("203.0.113.50") + ". Time: 0ms. POST https://home.example.com/emby/Users/AuthenticateByName");
            cur.Add("2026-10-13 07:31:00.000 Info PluginService-0HNPBBBB:00000002: http/2 Response 403 to " + Z("203.0.113.51") + ". Time: 0ms. GET https://home.example.com/emby/Plugins?api_key=SECRET");
            var scan = LogImporter.Scan(new[] { ("embyserver-1.txt", (IEnumerable<string>)rot), ("embyserver.txt", (IEnumerable<string>)cur) });
            var it = scan.Items;
            Ok(scan.Files == 2 && scan.Lines == rot.Count + cur.Count, "import: scans all files and lines");
            Ok(it.Count(x => x.Kind == LogImporter.ItemKind.SigninFailed && x.Ip == "203.0.113.110") == 2, "import: AUTH-ERROR invalid password -> failed sign-in (401 of same request not double counted)");
            Ok(it.Where(x => x.Ip == "203.0.113.110" && x.Kind == LogImporter.ItemKind.SigninFailed).All(x => x.Username == "admin"), "import: username from 'No user named' line");
            Ok(it.Count(x => x.Kind == LogImporter.ItemKind.Api && x.Path == "/Connect/Exchange") == 1, "import: token AUTH-ERROR + its 401 -> one API failure");
            Ok(it.All(x => x.Path == null || !x.Path.Contains("SECRET")), "import: query strings / keys never kept");
            Ok(it.Any(x => x.Kind == LogImporter.ItemKind.Forbidden && x.Ip == "203.0.113.50"), "import: 403 on sign-in -> forbidden sign-in");
            Ok(it.Any(x => x.Ip == "203.0.113.110" && x.Kind == LogImporter.ItemKind.SigninFailed && x.Time == new DateTimeOffset(new DateTime(2026, 10, 12, 22, 52, 9, 214, DateTimeKind.Local))), "import: bidi marks stripped, original local timestamp kept");
            Ok(it.Select(x => x.DedupeKey).Distinct().Count() == it.Count, "import: dedupe keys unique");

            var (e, h, s, dir) = New();
            h.Now = new DateTimeOffset(2026, 10, 13, 16, 0, 0, TimeSpan.Zero);
            // a manual permanent ban created now must not swallow the older events
            e.ManualBan("203.0.113.110", 0, "Manual", null, false);
            // the 203.0.113.50 forbidden sign-in was already logged live (auth event a second later)
            s.AddEvent(new GuardEvent { Time = new DateTimeOffset(new DateTime(2026, 10, 13, 7, 30, 1, DateTimeKind.Local)), Kind = EventKinds.Forbidden, Ip = "203.0.113.50", Key = "203.0.113.50" });
            h.Notified.Clear(); var ch = h.Changes;
            var r1 = GuardImport.Run(e, scan);
            Ok(r1.Found == it.Count && r1.AlreadyLogged == 1 && r1.Imported == it.Count - 1, $"import: imported {r1.Imported}, 1 already logged live");
            var auto = s.Bans.Where(b => b.Key == "203.0.113.110" && !b.Manual).ToList();
            Ok(auto.Count == 1 && auto[0].Rule == "instant-username" && auto[0].Created.LocalDateTime == new DateTime(2026, 10, 12, 22, 52, 7, 703), "import: ban rules applied at original time (instant 'admin')");
            Ok(auto[0].Ended == auto[0].Expires && auto[0].EndReason == "expired", "import: historical ban that ran out ends at its original expiry");
            Ok(s.FindActive("203.0.113.110", h.Now)?.Manual == true, "import: manual permanent ban still active");
            Ok(!s.Bans.Any(b => b.Key == "192.168.1.44"), "import: LAN address never banned (6 failures)");
            Ok(r1.LanOrWhitelisted == 7, "import: LAN/loopback items counted (" + r1.LanOrWhitelisted + ")");
            Ok(h.Notified.Count == 0, "import: no notification storm for historical bans");
            Ok(r1.NewBans == 1 && r1.StillActiveBans == 0, "import: new bans reported");
            var evs = s.ReadEvents(null, null, 1000);
            Ok(evs.Any(x => x.Kind == EventKinds.SigninFailed && x.Username == "admin" && x.Note.Contains("imported") && x.Time.LocalDateTime.Day == 12), "import: events stored with original time + 'imported'");
            Ok(File.ReadAllLines(Path.Combine(dir, "events", "2026-10-13.jsonl")).Any(l => l.Contains("imported")), "import: written to the day file");
            var r2 = GuardImport.Run(e, scan);
            Ok(r2.Imported == 0 && r2.AlreadyImported == it.Count, "import: second run imports nothing (dedupe)");
            // escalation continues from the imported history
            h.Now = new DateTimeOffset(2026, 10, 13, 17, 0, 0, TimeSpan.Zero);
            Fail(e, "203.0.113.111", "root");
            var (min, step) = e.NextDuration("203.0.113.110", h.Now);
            Ok(step == 1 && min == 1440, "import: imported ban counts for escalation (next = 1 day)");
            // current-file dedupe against live tail events (API 403 already logged live)
            var (e2, h2, s2, dir2) = New(); h2.Now = h.Now;
            s2.AddEvent(new GuardEvent { Time = new DateTimeOffset(new DateTime(2026, 10, 13, 7, 31, 0, DateTimeKind.Local)), Kind = EventKinds.Api403, Ip = "203.0.113.51", Key = "203.0.113.51" });
            var r3 = GuardImport.Run(e2, scan);
            Ok(r3.AlreadyLogged == 1 && !s2.ReadEvents(null, null, 1000).Any(x => x.Ip == "203.0.113.51" && x.Note != null && x.Note.Contains("imported")), "import: live API event not duplicated");
            Ok(LogImporter.FindLogs(dir).Count == 0, "import: FindLogs on a dir without logs");
            File.WriteAllText(Path.Combine(dir, "embyserver.txt"), ""); File.WriteAllText(Path.Combine(dir, "embyserver-63927446400.txt"), "");
            var fl = LogImporter.FindLogs(dir);
            Ok(fl.Count == 2 && Path.GetFileName(fl[1]) == "embyserver.txt", "import: rotated logs first, current last");
        }

        // ---------- MaxMind DB ----------
        {
            var p = args.Length > 0 ? args[0] : "GeoIP2-Country-Test.mmdb";
            if (File.Exists(p))
            {
                var db = MmdbReader.Open(p);
                Ok(db.DatabaseType.Contains("Country"), "mmdb metadata: " + db.DatabaseType);
                Ok(db.Country(IPAddress.Parse("81.2.69.160")) == "GB", "81.2.69.160 -> GB");
                Ok(db.Country(IPAddress.Parse("89.160.20.112")) == "SE", "89.160.20.112 -> SE");
                Ok(db.Country(IPAddress.Parse("2001:218::1")) == "JP", "2001:218::1 -> JP");
                Ok(db.Country(IPAddress.Parse("::ffff:81.2.69.160")) == "GB", "mapped v6 -> GB");
                Ok(db.Country(IPAddress.Parse("10.0.0.1")) == null, "private -> none");
            }
            else Ok(false, "mmdb test file missing: " + p);
        }

        Console.WriteLine($"{passes} passed, {fails} failed");
        return fails == 0 ? 0 : 1;
    }
}
