using System;
using System.Collections.Generic;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Drawing;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Claw.Emby.Guard
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IHasThumbImage
    {
        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
        }

        public static Plugin Instance { get; private set; }

        public override string Name => "Guard";

        public override string Description =>
            "fail2ban-style protection: bans IPs after failed sign-ins, forbidden sign-ins or repeated 401/403 API calls, using Emby's Remote IP filter (blacklist). Live log, bans, rules, whitelist.";

        public override Guid Id => Guid.Parse("07d4dd00-021a-4dc5-9964-837979319eca");

        public Stream GetThumbImage() => GetType().Assembly.GetManifestResourceStream(GetType().Namespace + ".Images.thumb.png");

        public ImageFormat ThumbImageFormat => ImageFormat.Png;

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = GetType().Namespace;
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "ClawGuard",
                    DisplayName = "Guard",
                    EnableInMainMenu = true,
                    MenuIcon = "shield",
                    EmbeddedResourcePath = ns + ".Web.guard.html"
                },
                new PluginPageInfo
                {
                    Name = "ClawGuard.js",
                    EmbeddedResourcePath = ns + ".Web.guard.js"
                }
            };
        }

        public override void UpdateConfiguration(BasePluginConfiguration configuration)
        {
            base.UpdateConfiguration(configuration);
            try { Server.GuardEntryPoint.Instance?.ApplyConfiguration(); } catch { }
        }
    }
}
