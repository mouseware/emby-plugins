using System;
using System.Collections.Generic;
using System.IO;
using Claw.Emby.DefaultChapters.Core;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Drawing;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Claw.Emby.DefaultChapters
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public const string PageName = "DefaultChapters";
        private static readonly object ManagerLock = new object();
        private static DefaultChaptersManager _manager;
        private static EmbyChapterHost _host;
        private readonly IApplicationPaths _paths;

        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
            _paths = applicationPaths;
        }

        public static Plugin Instance { get; private set; }

        public override string Name => "Default Chapters";

        public override string Description =>
            "Per-movie interval chapters (\"Chapter 1, 2 ...\" every N minutes) from the item menu, kept through library refreshes, with one-click restore of the original chapters.";

        public override Guid Id => Guid.Parse("b5671c07-59f4-4bbd-924e-0b2483056350");

        public string StorePath => Path.Combine(_paths.DataPath, "claw-defaultchapters", "overrides.json");

        public Stream GetThumbImage()
        {
            return GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".Images.thumb.png");
        }

        public ImageFormat ThumbImageFormat => ImageFormat.Png;

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = GetType().Namespace;
            return new[]
            {
                new PluginPageInfo
                {
                    Name = PageName,
                    DisplayName = "Default Chapters",
                    EnableInMainMenu = false,
                    MenuIcon = "bookmarks",
                    EmbeddedResourcePath = ns + ".Web.config.html"
                },
                new PluginPageInfo
                {
                    Name = PageName + ".js",
                    EmbeddedResourcePath = ns + ".Web.config.js"
                }
            };
        }

        internal Stream GetInjectScriptStream()
        {
            return GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".Inject.claw-default-chapters.js");
        }

        /// <summary>One shared manager for the API service, the metadata provider and the entry point.</summary>
        internal static DefaultChaptersManager GetManager(ILibraryManager libraryManager, IFileSystem fileSystem, ILogManager logManager)
        {
            if (_manager != null) return _manager;
            lock (ManagerLock)
            {
                if (_manager != null) return _manager;
                if (Instance == null) throw new InvalidOperationException("Default Chapters plugin is not loaded yet.");
                var logger = logManager.GetLogger("DefaultChapters");
                _host = new EmbyChapterHost(libraryManager, fileSystem, logger);
                _manager = new DefaultChaptersManager(
                    _host,
                    new OverrideStore(Instance.StorePath),
                    () => Instance.Configuration == null ? 5 : Instance.Configuration.IntervalMinutes,
                    msg => logger.Info(msg));
                return _manager;
            }
        }

        internal static EmbyChapterHost Host => _host;
    }
}
