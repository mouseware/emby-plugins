using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Claw.Emby.Guard.Core
{
    /// <summary>
    /// One-shot import of the existing embyserver*.txt logs (current + rotated). Recognised lines (Emby 4.10.1):
    ///   "... Error DefaultAuthenticationProvider: Invalid username or password. No user named admin exists"
    ///   "... Warn UserService-0HNP8:00000006: AUTH-ERROR: 1.2.3.4 - Invalid username or password entered."
    ///   "... Info UserService-0HNP8:00000006: http/1.1 Response 401 to 1.2.3.4. Time: 1ms. POST https://host/Users/AuthenticateByName"
    /// Lines are grouped by request id (connection:sequence) so one request yields one event:
    ///   AUTH-ERROR "Invalid username or password" -> failed sign-in (username from the preceding "No user named" line);
    ///   Response 403 on a sign-in endpoint -> forbidden sign-in; any other 401/403 response -> API failure.
    /// AUTH-ERROR lines about tokens are covered by their Response line. Invisible/bidi marks around IPs are stripped.
    /// </summary>
    public static class LogImporter
    {
        private static readonly Regex Head = new Regex(@"^(?<ts>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?) (?<lvl>\w+) (?<svc>[A-Za-z0-9_.]+?)(?:-(?<rid>[^\s:]+:[^\s:]+))?: (?<msg>.*)$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly Regex AuthErr = new Regex(@"^AUTH-ERROR: (?<ip>\S+) - (?<m>.*)$", RegexOptions.Compiled);
        private static readonly Regex NoUser = new Regex(@"No user named (?<u>.+?) exists", RegexOptions.Compiled);

        public enum ItemKind { SigninFailed, Forbidden, Api }

        public class Item
        {
            public DateTimeOffset Time { get; set; }
            public ItemKind Kind { get; set; }
            public string Ip { get; set; }
            public string Username { get; set; }
            public int Status { get; set; }
            public string Method { get; set; }
            public string Path { get; set; }
            public bool IsSigninEndpoint { get; set; }
            /// <summary>Stable id for "already imported" (time to the ms + request id + kind).</summary>
            public string DedupeKey { get; set; }
        }

        public class ScanResult
        {
            public List<Item> Items { get; } = new List<Item>();
            public int Files { get; set; }
            public long Lines { get; set; }
        }

        /// <summary>Log files oldest first: rotated embyserver-*.txt, then embyserver.txt.</summary>
        public static List<string> FindLogs(string dir)
        {
            if (!Directory.Exists(dir)) return new List<string>();
            return Directory.GetFiles(dir, "embyserver*.txt")
                .OrderBy(f => Path.GetFileName(f).Equals("embyserver.txt", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
                .ThenBy(f => File.GetLastWriteTimeUtc(f)).ToList();
        }

        public static IEnumerable<string> ReadShared(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var r = new StreamReader(fs))
            {
                string l;
                while ((l = r.ReadLine()) != null) yield return l;
            }
        }

        public static ScanResult Scan(IEnumerable<string> files) => Scan(files.Select(f => (f, ReadShared(f))));

        public static ScanResult Scan(IEnumerable<(string name, IEnumerable<string> lines)> files)
        {
            var res = new ScanResult();
            foreach (var (name, lines) in files)
            {
                res.Files++;
                // request id -> pending item (one per request)
                var byReq = new Dictionary<string, Item>();
                var order = new List<Item>();
                string lastNoUser = null; DateTimeOffset lastNoUserTime = default;
                foreach (var raw in lines)
                {
                    res.Lines++;
                    if (raw.IndexOf("AUTH-ERROR", StringComparison.Ordinal) < 0 && raw.IndexOf("No user named", StringComparison.Ordinal) < 0
                        && raw.IndexOf(" Response 40", StringComparison.Ordinal) < 0) continue;
                    var s = IpUtil.StripInvisible(raw);
                    var h = Head.Match(s);
                    if (!h.Success) continue;
                    if (!DateTime.TryParseExact(h.Groups["ts"].Value, new[] { "yyyy-MM-dd HH:mm:ss.fff", "yyyy-MM-dd HH:mm:ss" }, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var lt)) continue;
                    var t = new DateTimeOffset(lt);
                    var msg = h.Groups["msg"].Value;
                    var rid = h.Groups["rid"].Success ? h.Groups["rid"].Value : null;

                    var nu = NoUser.Match(msg);
                    if (nu.Success && msg.IndexOf("AUTH-ERROR", StringComparison.Ordinal) < 0) { lastNoUser = nu.Groups["u"].Value.Trim(); lastNoUserTime = t; continue; }

                    var ae = AuthErr.Match(msg);
                    if (ae.Success)
                    {
                        if (ae.Groups["m"].Value.IndexOf("Invalid username or password", StringComparison.OrdinalIgnoreCase) < 0) continue; // token errors: Response line covers it
                        string user = null;
                        if (lastNoUser != null && (t - lastNoUserTime).Duration() <= TimeSpan.FromSeconds(2)) user = lastNoUser;
                        lastNoUser = null;
                        var it = new Item { Time = t, Kind = ItemKind.SigninFailed, Ip = ae.Groups["ip"].Value.Trim(), Username = user, Status = 401, IsSigninEndpoint = true };
                        var k = rid ?? ("t" + t.UtcTicks);
                        if (byReq.TryGetValue(k, out var prev)) { prev.Kind = ItemKind.SigninFailed; prev.Username = user; prev.Status = 401; }
                        else { byReq[k] = it; order.Add(it); }
                        continue;
                    }

                    var r = LogLineParser.Parse(raw);
                    if (r == null) continue;
                    var key = rid ?? ("t" + t.UtcTicks);
                    if (byReq.TryGetValue(key, out var existing))
                    {
                        // already a failed sign-in for this request: the 401 is the same event
                        if (existing.Path == null) { existing.Method = r.Method; existing.Path = r.Path; }
                        continue;
                    }
                    var item = new Item
                    {
                        Time = t, Ip = r.Ip, Status = r.Status, Method = r.Method, Path = r.Path, IsSigninEndpoint = r.IsSigninEndpoint,
                        Kind = r.IsSigninEndpoint && r.Status == 403 ? ItemKind.Forbidden : ItemKind.Api
                    };
                    byReq[key] = item; order.Add(item);
                }
                foreach (var kv in byReq) kv.Value.DedupeKey = kv.Value.Time.UtcDateTime.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture) + "|" + kv.Key + "|" + kv.Value.Kind;
                res.Items.AddRange(order);
            }
            return res;
        }
    }

    public class ImportResult
    {
        public int Files { get; set; }
        public long LinesScanned { get; set; }
        public int Found { get; set; }
        public int Imported { get; set; }
        public int AlreadyImported { get; set; }
        public int AlreadyLogged { get; set; }
        public int SigninFailures { get; set; }
        public int Forbidden { get; set; }
        public int ApiFailures { get; set; }
        public int LanOrWhitelisted { get; set; }
        public int NewBans { get; set; }
        public int StillActiveBans { get; set; }
        public DateTimeOffset? From { get; set; }
        public DateTimeOffset? To { get; set; }
        public string Error { get; set; }
    }

    /// <summary>Replays scanned log items through the engine with their original timestamps.</summary>
    public static class GuardImport
    {
        public const string KeysFile = "imported-keys.txt";

        private static bool SameFamily(LogImporter.Item i, GuardEvent e)
        {
            if (i.Kind == LogImporter.ItemKind.Api) return e.Kind == EventKinds.Api401 || e.Kind == EventKinds.Api403 || e.Kind == EventKinds.Blocked;
            return e.Kind == EventKinds.SigninFailed || e.Kind == EventKinds.Forbidden;
        }

        public static ImportResult Run(GuardEngine engine, LogImporter.ScanResult scan)
        {
            var store = engine.Store;
            var res = new ImportResult { Files = scan.Files, LinesScanned = scan.Lines, Found = scan.Items.Count };
            var keysPath = Path.Combine(store.Directory, KeysFile);
            var done = new HashSet<string>(File.Exists(keysPath) ? File.ReadAllLines(keysPath) : Array.Empty<string>(), StringComparer.Ordinal);
            var items = scan.Items.OrderBy(i => i.Time).ToList();
            if (items.Count == 0) return res;
            res.From = items[0].Time; res.To = items[items.Count - 1].Time;

            // Events Guard already logged live (tail or auth event) in the same period: match each once by family + IP + time (±5 s).
            var live = store.ReadEvents(res.From.Value.AddMinutes(-1), res.To.Value.AddMinutes(1), int.MaxValue)
                .Where(e => e.Ip != null).GroupBy(e => IpUtil.Parse(e.Ip)?.ToString() ?? e.Ip).ToDictionary(g => g.Key, g => g.ToList());
            var newKeys = new List<string>();
            var bansBefore = store.Bans.Count;

            store.ImportTag = "imported";
            try { engine.RunQuiet(() =>
            {
                foreach (var it in items)
                {
                    if (done.Contains(it.DedupeKey)) { res.AlreadyImported++; continue; }
                    var ip = IpUtil.Parse(it.Ip);
                    if (ip == null) continue;
                    var ipText = ip.ToString();
                    if (live.TryGetValue(ipText, out var cands))
                    {
                        var m = cands.FirstOrDefault(e => SameFamily(it, e) && (e.Time - it.Time).Duration() <= TimeSpan.FromSeconds(5));
                        if (m != null) { cands.Remove(m); res.AlreadyLogged++; done.Add(it.DedupeKey); newKeys.Add(it.DedupeKey); continue; }
                    }
                    if (engine.ExemptReason(ip) != null) res.LanOrWhitelisted++;
                    GuardEvent ev;
                    if (it.Kind == LogImporter.ItemKind.Api)
                    {
                        ev = engine.OnApiFailure(new ApiFailure { Ip = ipText, Status = it.Status, Method = it.Method, Path = it.Path, IsSigninEndpoint = it.IsSigninEndpoint, Time = it.Time });
                        res.ApiFailures++;
                    }
                    else
                    {
                        ev = engine.OnAuth(new AuthAttempt
                        {
                            Ip = ipText, Username = it.Username, Forbidden = it.Kind == LogImporter.ItemKind.Forbidden, Time = it.Time,
                            Client = it.Path == null ? "imported from log" : (it.Method + " " + it.Path)
                        });
                        if (it.Kind == LogImporter.ItemKind.Forbidden) res.Forbidden++; else res.SigninFailures++;
                    }
                    res.Imported++;
                    done.Add(it.DedupeKey); newKeys.Add(it.DedupeKey);
                }
                return 0;
            }); } finally { store.ImportTag = null; }
            if (newKeys.Count > 0) File.AppendAllLines(keysPath, newKeys);
            res.NewBans = store.Bans.Count - bansBefore;
            engine.Sweep(); // historical bans that already ran out end at their original expiry
            res.StillActiveBans = store.Bans.Skip(bansBefore).Count(b => b.IsActive(DateTimeOffset.Now));
            store.Save();
            return res;
        }
    }
}
