using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Drawing;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Claw.Emby.CustomItemUI
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
        }

        public static Plugin Instance { get; private set; }

        public override string Name => "Custom Item UI";

        public override string Description =>
            "Item page tweaks (move Links up, VLC path links, raised link buttons) and a rearrangeable admin Dashboard layout. Survives Emby updates via startup inject.";

        public override Guid Id => Guid.Parse("b7e4c2a1-9f3d-4e8b-a6c5-1d2e3f4a5b6c");

        public Stream GetThumbImage()
        {
            return GetType().Assembly.GetManifestResourceStream(
                GetType().Namespace + ".Images.thumb.png");
        }

        public ImageFormat ThumbImageFormat => ImageFormat.Png;

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = GetType().Namespace;
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "CustomItemUI",
                    DisplayName = "Custom Item UI",
                    EnableInMainMenu = true,
                    MenuIcon = "design_services",
                    EmbeddedResourcePath = ns + ".Web.config.html"
                },
                new PluginPageInfo
                {
                    Name = "CustomItemUI.js",
                    EmbeddedResourcePath = ns + ".Web.config.js"
                }
            };
        }

        internal Stream GetInjectScriptStream()
        {
            var name = GetType().Namespace + ".Inject.claw-custom-item-ui.js";
            return GetType().Assembly.GetManifestResourceStream(name);
        }
    }
}