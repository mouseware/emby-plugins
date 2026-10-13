using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;

namespace Claw.Emby.Guard.Core
{
    /// <summary>IP parsing, normalisation, CIDR matching and the "never ban" safety ranges.</summary>
    public static class IpUtil
    {
        // Invisible marks Emby wraps around IPs/hosts in embyserver.txt (U+200C/U+200D etc).
        public static string StripInvisible(string s)
        {
            if (string.IsNullOrEmpty(s)) return s ?? "";
            var sb = new System.Text.StringBuilder(s.Length);
            foreach (var ch in s)
            {
                if ((ch >= '\u200B' && ch <= '\u200F') || (ch >= '\u202A' && ch <= '\u202E') || (ch >= '\u2060' && ch <= '\u2069') || ch == '\uFEFF') continue; // zero-width + bidi marks
                sb.Append(ch);
            }
            return sb.ToString();
        }

        /// <summary>Parses an address, trimming brackets/ports/zone ids and mapping ::ffff:a.b.c.d to IPv4.</summary>
        public static IPAddress Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var s = StripInvisible(text).Trim();
            if (s.StartsWith("[") && s.Contains("]")) s = s.Substring(1, s.IndexOf(']') - 1);
            else if (s.Count(c => c == ':') == 1 && s.Contains('.')) s = s.Substring(0, s.IndexOf(':')); // a.b.c.d:port
            var pct = s.IndexOf('%');
            if (pct > 0) s = s.Substring(0, pct);
            if (!IPAddress.TryParse(s, out var ip)) return null;
            return Normalize(ip);
        }

        public static IPAddress Normalize(IPAddress ip)
        {
            if (ip == null) return null;
            if (ip.AddressFamily == AddressFamily.InterNetworkV6 && ip.IsIPv4MappedToIPv6) return ip.MapToIPv4();
            return ip;
        }

        /// <summary>The ban key: "a.b.c.d" for IPv4, "prefix::/N" for IPv6 (N = configured prefix, 128 = single address).</summary>
        public static string BanKey(IPAddress ip, int v6Prefix)
        {
            ip = Normalize(ip);
            if (ip == null) return null;
            if (ip.AddressFamily == AddressFamily.InterNetwork) return ip.ToString();
            if (v6Prefix < 16) v6Prefix = 16;
            if (v6Prefix >= 128) return ip.ToString();
            var masked = Mask(ip, v6Prefix);
            return masked + "/" + v6Prefix;
        }

        public static IPAddress Mask(IPAddress ip, int prefix)
        {
            var b = ip.GetAddressBytes();
            for (int i = 0; i < b.Length; i++)
            {
                int bits = Math.Max(0, Math.Min(8, prefix - i * 8));
                b[i] = (byte)(b[i] & (bits == 0 ? 0 : (0xFF << (8 - bits)) & 0xFF));
            }
            return new IPAddress(b);
        }

        /// <summary>Parses "a.b.c.d", "a.b.c.d/nn", "v6", "v6/nn". Returns false for junk.</summary>
        public static bool TryParseCidr(string text, out IPAddress network, out int prefix)
        {
            network = null; prefix = 0;
            if (string.IsNullOrWhiteSpace(text)) return false;
            var s = StripInvisible(text).Trim();
            var slash = s.IndexOf('/');
            var ipPart = slash >= 0 ? s.Substring(0, slash) : s;
            var ip = Parse(ipPart);
            if (ip == null) return false;
            int max = ip.AddressFamily == AddressFamily.InterNetwork ? 32 : 128;
            if (slash >= 0)
            {
                var p = s.Substring(slash + 1);
                // Accept dotted netmask too (255.255.255.0)
                if (p.Contains('.') && IPAddress.TryParse(p, out var mask))
                {
                    prefix = mask.GetAddressBytes().Sum(x => Convert.ToString(x, 2).Count(c => c == '1'));
                }
                else if (!int.TryParse(p, out prefix)) return false;
                if (prefix < 0 || prefix > max) return false;
            }
            else prefix = max;
            network = Mask(ip, prefix);
            return true;
        }

        public static bool InCidr(IPAddress ip, string cidr)
        {
            ip = Normalize(ip);
            if (ip == null || !TryParseCidr(cidr, out var net, out var prefix)) return false;
            if (ip.AddressFamily != net.AddressFamily) return false;
            return Mask(ip, prefix).Equals(net);
        }

        /// <summary>Does the ban key (address or CIDR) cover this address?</summary>
        public static bool KeyCovers(string key, IPAddress ip) => InCidr(ip, key);

        public static readonly string[] SafeRanges =
        {
            "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10", "0.0.0.0/8",
            "::1/128", "::/128", "fc00::/7", "fe80::/10"
        };

        /// <summary>Loopback, RFC1918, link-local, CGNAT/Tailscale (100.64/10), ULA. Never banned.</summary>
        public static bool IsAlwaysSafe(IPAddress ip, IEnumerable<string> extraLocalSubnets = null)
        {
            ip = Normalize(ip);
            if (ip == null) return true; // unknown address: never act on it
            if (IPAddress.IsLoopback(ip)) return true;
            foreach (var r in SafeRanges) if (InCidr(ip, r)) return true;
            if (extraLocalSubnets != null) foreach (var r in extraLocalSubnets) if (InCidr(ip, r)) return true;
            return false;
        }
    }
}
