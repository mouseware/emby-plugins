using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Logging;

namespace Claw.Emby.CustomItemUI
{
    public class InjectEntryPoint : IServerEntryPoint
    {
        public const string ScriptFileName = "claw-custom-item-ui.js";
        private readonly ILogger _logger;

        public InjectEntryPoint(ILogManager logManager)
        {
            _logger = logManager.GetLogger("CustomItemUI");
        }

        public void Run()
        {
            try
            {
                Deploy(_logger);
            }
            catch (Exception ex)
            {
                _logger.ErrorException("Custom Item UI: failed to deploy web inject", ex);
            }
        }

        public void Dispose()
        {
        }

        public static void Deploy(ILogger logger = null)
        {
            if (Plugin.Instance == null)
            {
                throw new InvalidOperationException("Plugin instance not ready.");
            }

            var dashboardUi = ResolveDashboardUiPath();
            if (string.IsNullOrEmpty(dashboardUi) || !Directory.Exists(dashboardUi))
            {
                throw new DirectoryNotFoundException("Could not locate Emby dashboard-ui folder.");
            }

            var scriptPath = Path.Combine(dashboardUi, ScriptFileName);
            var indexPath = Path.Combine(dashboardUi, "index.html");

            using (var stream = Plugin.Instance.GetInjectScriptStream())
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("Embedded inject script missing.");
                }

                string js;
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    js = reader.ReadToEnd();
                }

                js = js.Replace("__PLUGIN_ID__", Plugin.Instance.Id.ToString());
                File.WriteAllText(scriptPath, js, new UTF8Encoding(false));
            }

            EnsureScriptTag(indexPath);
            logger?.Info("Custom Item UI deployed to {0}", dashboardUi);
        }

        private static string ResolveDashboardUiPath()
        {
            var controllerAsm = typeof(IServerEntryPoint).Assembly.Location;
            if (!string.IsNullOrEmpty(controllerAsm))
            {
                var systemDir = Path.GetDirectoryName(controllerAsm);
                var candidate = Path.Combine(systemDir ?? string.Empty, "dashboard-ui");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
            }

            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var fallback = Path.Combine(appData, "Emby-Server", "system", "dashboard-ui");
            return Directory.Exists(fallback) ? fallback : null;
        }

        private static void EnsureScriptTag(string indexPath)
        {
            if (!File.Exists(indexPath))
            {
                throw new FileNotFoundException("Emby index.html not found", indexPath);
            }

            var html = File.ReadAllText(indexPath, Encoding.UTF8);
            if (html.IndexOf(ScriptFileName, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return;
            }

            var tag = "<script src=\"" + ScriptFileName + "\" defer></script>";
            var replaced = Regex.Replace(
                html,
                "(<script\\s+src=[\"']apploader\\.js[\"'][^>]*>\\s*</script>)",
                tag + "\n    $1",
                RegexOptions.IgnoreCase);

            if (replaced == html)
            {
                replaced = Regex.IsMatch(html, "</body>", RegexOptions.IgnoreCase)
                    ? Regex.Replace(html, "</body>", "    " + tag + "\n</body>", RegexOptions.IgnoreCase)
                    : html + "\n" + tag + "\n";
            }

            File.WriteAllText(indexPath, replaced, new UTF8Encoding(false));
        }
    }
}