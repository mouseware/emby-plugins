using System;
using System.Text.RegularExpressions;

namespace Claw.Emby.SeerrRequests.Core
{
    /// <summary>Masking and log redaction for the Seerr API key. The raw key must never appear in logs or UI responses.</summary>
    public static class ApiKeyGuard
    {
        public const string MaskPrefix = "••••••••";

        public static string Mask(string key)
        {
            if (string.IsNullOrEmpty(key)) return "";
            if (key.Length <= 4) return MaskPrefix;
            return MaskPrefix + key.Substring(key.Length - 4);
        }

        /// <summary>True when the posted value should be ignored and the stored key kept (blank, or the masked display value).</summary>
        public static bool IsMaskedOrEmpty(string posted)
        {
            if (string.IsNullOrWhiteSpace(posted)) return true;
            var t = posted.Trim();
            if (t.IndexOf('•') >= 0 || t.IndexOf('*') >= 0) return true;
            if (t.StartsWith("....", StringComparison.Ordinal) || t.StartsWith("xxxx", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        public static string ResolvePostedKey(string posted, string existing)
        {
            return IsMaskedOrEmpty(posted) ? (existing ?? "") : posted.Trim();
        }

        public static string Sanitize(string text, string key)
        {
            if (string.IsNullOrEmpty(text)) return text;
            var s = text;
            if (!string.IsNullOrEmpty(key) && s.IndexOf(key, StringComparison.Ordinal) >= 0)
                s = s.Replace(key, "REDACTED");
            s = Regex.Replace(s, "(?i)(X-Api-Key|X-API-Key|ApiKey|api[_-]?key|Authorization)\\s*[:=]\\s*[^\\s,;]+", "$1=REDACTED");
            return s;
        }
    }
}
