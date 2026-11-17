using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Drawing;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Claw.Emby.SeerrRequests
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public const string PluginGuid = "c3a91e08-4b7d-4f2a-9e16-8d5c2b0a7f31";

        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
        }

        public static Plugin Instance { get; private set; }

        public override string Name => "Seerr Requests";

        public override string Description =>
            "Adds \"Request this now\" to the item menu on trailers and unowned movies and shows. Status is checked in Seerr first so duplicates are not sent. Requests go out server-side as the matched Seerr user.";

        public override Guid Id => Guid.Parse(PluginGuid);

        public Stream GetThumbImage()
        {
            return GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".Images.thumb.png");
        }

        public ImageFormat ThumbImageFormat => ImageFormat.Png;

        internal Stream GetInjectScriptStream()
        {
            return GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".Inject.claw-seerr-requests.js");
        }

        public string DataDirectory
        {
            get
            {
                var root = ApplicationPaths != null ? ApplicationPaths.DataPath : Path.Combine(Path.GetTempPath(), "claw-seerrrequests");
                return Path.Combine(root, "claw-seerrrequests");
            }
        }

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = GetType().Namespace;
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "ClawSeerrRequests",
                    DisplayName = "Seerr Requests",
                    EnableInMainMenu = true,
                    MenuIcon = "add_to_queue",
                    EmbeddedResourcePath = ns + ".Web.config.html"
                },
                new PluginPageInfo
                {
                    Name = "ClawSeerrRequests.js",
                    EmbeddedResourcePath = ns + ".Web.config.js"
                }
            };
        }
    }
}
