using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Drawing;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Claw.Emby.IptvMapper.Configuration;

namespace Claw.Emby.IptvMapper
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public const string PluginGuid = "e5b612ae-cad5-47e9-8fb3-27a029c220d3";

        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
        }

        public static Plugin Instance { get; private set; }

        /// <summary>Master switch (General tab); true while the configuration is not loaded.</summary>
        public static bool IsEnabled => Instance?.Configuration == null || Instance.Configuration.Enabled;

        public override string Name => "IPTV Channel Mapper";

        public override string Description =>
            "Table editor for IPTV Live TV channels: numbers, names, logos, guide mapping and enable/disable, with undo/redo and snapshots.";

        public override Guid Id => Guid.Parse(PluginGuid);

        public ImageFormat ThumbImageFormat => ImageFormat.Png;

        /// <summary>Plugin tile icon: Material Symbols "developer_mode_tv" (Apache 2.0), #52B54B on #1c1c1c, 640x360.</summary>
        public Stream GetThumbImage()
        {
            return GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".thumb.png");
        }

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = GetType().Namespace;
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "IptvMapper",
                    DisplayName = "IPTV Channel Mapper",
                    EnableInMainMenu = true,
                    MenuIcon = "dvr",
                    EmbeddedResourcePath = ns + ".Web.config.html"
                },
                new PluginPageInfo
                {
                    Name = "IptvMapper.js",
                    EmbeddedResourcePath = ns + ".Web.config.js"
                }
            };
        }
    }
}
