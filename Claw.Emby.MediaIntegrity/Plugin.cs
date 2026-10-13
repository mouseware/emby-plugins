using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Drawing;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Claw.Emby.MediaIntegrity
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer) : base(applicationPaths, xmlSerializer) { Instance = this; }

        public static Plugin Instance { get; private set; }
        public override string Name => "Media Integrity";
        public override string Description => "Bit-rot / corruption checks: MD5 baseline for every library file, background hashing of new items, resumable low-priority full scan (Scheduled task), problems, browse, history.";
        public override Guid Id => Guid.Parse("5b0c7f3e-2d4a-4e61-9a8b-6c1f0e7d3a52");

        public Stream GetThumbImage() => GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".Images.thumb.png");
        public ImageFormat ThumbImageFormat => ImageFormat.Png;
        internal Stream GetInjectScriptStream() => GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".Inject.claw-media-integrity.js");

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = GetType().Namespace;
            return new[]
            {
                new PluginPageInfo { Name = "ClawMediaIntegrity", DisplayName = "Media Integrity", EnableInMainMenu = true, MenuIcon = "health_and_safety", EmbeddedResourcePath = ns + ".Web.integrity.html" },
                new PluginPageInfo { Name = "ClawMediaIntegrity.js", EmbeddedResourcePath = ns + ".Web.integrity.js" }
            };
        }

        public override void UpdateConfiguration(BasePluginConfiguration configuration)
        {
            base.UpdateConfiguration(configuration);
            try { Server.IntegrityHost.Instance?.ApplyConfiguration(); } catch { }
        }
    }
}
