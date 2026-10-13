using System;
using System.Text.RegularExpressions;

namespace Claw.Emby.DefaultChapters.Core
{
    /// <summary>Pure string patching of Emby's dashboard-ui/index.html (unit-tested).</summary>
    public static class IndexHtmlPatcher
    {
        /// <summary>Adds a deferred script tag before apploader.js (or before body end). Idempotent by file name.</summary>
        public static string AddScriptTag(string html, string scriptFileName)
        {
            if (html.IndexOf(scriptFileName, StringComparison.OrdinalIgnoreCase) >= 0) return html;

            var tag = "<script src=\"" + scriptFileName + "\" defer></script>";
            var replaced = Regex.Replace(html,
                "(<script\\s+src=[\"']apploader\\.js[\"'][^>]*>\\s*</script>)",
                tag + "\n    $1",
                RegexOptions.IgnoreCase);
            if (replaced != html) return replaced;

            return Regex.IsMatch(html, "</body>", RegexOptions.IgnoreCase)
                ? Regex.Replace(html, "</body>", "    " + tag + "\n</body>", RegexOptions.IgnoreCase)
                : html + "\n" + tag + "\n";
        }
    }
}
