using System;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Claw.Emby.Guard.Core
{
    /// <summary>
    /// Parses Emby 4.10.1 embyserver.txt response lines (logged at Info level, always on):
    /// "2026-10-12 12:48:14.289 Info PluginService-0HNP8CJGIATKU:00000059: http/2 Response 403 to ‌‍‍1.2.3.4‌. Time: 0ms. GET https://‌‍‍host‌/emby/Plugins?..."
    /// IPs and hosts are wrapped in invisible U+200C/U+200D marks (stripped first).
    /// </summary>
    public static class LogLineParser
    {
        private static readonly Regex Rx = new Regex(
            @"^(?<ts>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?) \w+ (?<svc>[A-Za-z0-9_.]+)-[^\s:]+:[^\s:]+: (?<proto>\S+) Response (?<code>\d{3}) to (?<ip>.+?)\. Time: \S+ (?<method>[A-Z]+) (?<url>\S+)",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        public class Line
        {
            public DateTime LocalTime { get; set; }
            public string Service { get; set; }
            public int Status { get; set; }
            public string Ip { get; set; }
            public string Method { get; set; }
            /// <summary>Path only; query string (tokens, api_key) removed.</summary>
            public string Path { get; set; }
            public bool IsSigninEndpoint { get; set; }
        }

        public static Line Parse(string raw)
        {
            if (string.IsNullOrEmpty(raw) || raw.IndexOf(" Response 40", StringComparison.Ordinal) < 0) return null;
            var s = IpUtil.StripInvisible(raw);
            var m = Rx.Match(s);
            if (!m.Success) return null;
            var code = int.Parse(m.Groups["code"].Value, CultureInfo.InvariantCulture);
            if (code != 401 && code != 403) return null;
            DateTime.TryParseExact(m.Groups["ts"].Value, new[] { "yyyy-MM-dd HH:mm:ss.fff", "yyyy-MM-dd HH:mm:ss" }, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var ts);
            var url = m.Groups["url"].Value;
            string path = url;
            if (Uri.TryCreate(url, UriKind.Absolute, out var u)) path = u.AbsolutePath;
            var q = path.IndexOf('?'); if (q >= 0) path = path.Substring(0, q);
            return new Line
            {
                LocalTime = ts, Service = m.Groups["svc"].Value, Status = code, Ip = m.Groups["ip"].Value.Trim(),
                Method = m.Groups["method"].Value, Path = path,
                IsSigninEndpoint = path.IndexOf("/Users/AuthenticateByName", StringComparison.OrdinalIgnoreCase) >= 0
                    || path.IndexOf("/Authenticate", StringComparison.OrdinalIgnoreCase) >= 0 && path.IndexOf("/Users/", StringComparison.OrdinalIgnoreCase) >= 0
                    || path.IndexOf("/Connect/Exchange", StringComparison.OrdinalIgnoreCase) >= 0
            };
        }
    }
}
