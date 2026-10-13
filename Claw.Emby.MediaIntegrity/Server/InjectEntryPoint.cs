using System;
using System.IO;
using System.Text;
using System.Threading;
using Claw.Emby.MediaIntegrity.Core;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Logging;

namespace Claw.Emby.MediaIntegrity.Server
{
    /// <summary>
    /// Emby 4.10 has no server-side API for the item "..." menu, so the "Verify integrity" entry is added by a
    /// small script in the web client (it registers an itemmanager command source). This entry point
    /// writes that script into dashboard-ui and adds a script tag to index.html.
    ///
    /// Other plugins (Custom Item UI, Default Chapters) also rewrite index.html at startup. To avoid two writers racing,
    /// the deploy runs on a delay and re-checks once more later; it never holds an exclusive lock.
    /// </summary>
    public class InjectEntryPoint : IServerEntryPoint
    {
        public const string ScriptFileName = "claw-media-integrity.js";
        private static readonly TimeSpan FirstDelay = TimeSpan.FromSeconds(25);
        private static readonly TimeSpan RecheckDelay = TimeSpan.FromSeconds(100);

        private readonly ILogger _logger;
        private readonly ILibraryManager _libraryManager;
        private readonly IFileSystem _fileSystem;
        private readonly ILogManager _logManager;
        private Timer _first;
        private Timer _recheck;

        public InjectEntryPoint(ILibraryManager libraryManager, IFileSystem fileSystem, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _fileSystem = fileSystem;
            _logManager = logManager;
            _logger = logManager.GetLogger("MediaIntegrity");
        }

        public void Run()
        {
            _first = new Timer(_ => SafeDeploy("startup"), null, FirstDelay, Timeout.InfiniteTimeSpan);
            _recheck = new Timer(_ => SafeDeploy("re-check"), null, RecheckDelay, Timeout.InfiniteTimeSpan);
        }

        public void Dispose()
        {
            _first?.Dispose();
            _recheck?.Dispose();
        }

        private void SafeDeploy(string reason)
        {
            for (var attempt = 1; attempt <= 5; attempt++)
            {
                try
                {
                    var changed = Deploy();
                    _logger.Info("Media Integrity: web inject {0} ({1})", changed ? "deployed" : "already present", reason);
                    return;
                }
                catch (IOException ex)
                {
                    _logger.Debug("Media Integrity: inject attempt {0} hit a busy file: {1}", attempt, ex.Message);
                    Thread.Sleep(TimeSpan.FromSeconds(2 * attempt));
                }
                catch (Exception ex)
                {
                    _logger.ErrorException("Media Integrity: failed to deploy web inject", ex);
                    return;
                }
            }
            _logger.Error("Media Integrity: gave up deploying the web inject after 5 attempts ({0})", reason);
        }

        /// <summary>Returns true when anything on disk was changed.</summary>
        public static bool Deploy()
        {
            if (global::Claw.Emby.MediaIntegrity.Plugin.Instance == null) throw new InvalidOperationException("Plugin instance not ready.");

            var dashboardUi = ResolveDashboardUiPath();
            if (string.IsNullOrEmpty(dashboardUi)) throw new DirectoryNotFoundException("Could not locate Emby dashboard-ui folder.");

            string js;
            using (var stream = global::Claw.Emby.MediaIntegrity.Plugin.Instance.GetInjectScriptStream())
            {
                if (stream == null) throw new InvalidOperationException("Embedded inject script missing.");
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    js = reader.ReadToEnd();
                }
            }
            js = js.Replace("__PLUGIN_VERSION__", global::Claw.Emby.MediaIntegrity.Plugin.Instance.Version.ToString());

            var changed = false;
            var scriptPath = Path.Combine(dashboardUi, ScriptFileName);
            if (!File.Exists(scriptPath) || File.ReadAllText(scriptPath, Encoding.UTF8) != js)
            {
                File.WriteAllText(scriptPath, js, new UTF8Encoding(false));
                changed = true;
            }

            return EnsureScriptTag(Path.Combine(dashboardUi, "index.html")) || changed;
        }

        private static string ResolveDashboardUiPath()
        {
            var controllerAsm = typeof(IServerEntryPoint).Assembly.Location;
            if (!string.IsNullOrEmpty(controllerAsm))
            {
                var candidate = Path.Combine(Path.GetDirectoryName(controllerAsm) ?? string.Empty, "dashboard-ui");
                if (Directory.Exists(candidate)) return candidate;
            }
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var fallback = Path.Combine(appData, "Emby-Server", "system", "dashboard-ui");
            return Directory.Exists(fallback) ? fallback : null;
        }

        /// <summary>Adds our tag before apploader.js (or before body end). Idempotent by file name.</summary>
        public static bool EnsureScriptTag(string indexPath)
        {
            if (!File.Exists(indexPath)) throw new FileNotFoundException("Emby index.html not found", indexPath);

            var html = File.ReadAllText(indexPath, Encoding.UTF8);
            var updated = IndexHtmlPatcher.AddScriptTag(html, ScriptFileName);
            if (updated == html) return false;
            File.WriteAllText(indexPath, updated, new UTF8Encoding(false));
            return true;
        }
    }
}
