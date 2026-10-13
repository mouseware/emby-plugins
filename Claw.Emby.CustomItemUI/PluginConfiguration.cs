using MediaBrowser.Model.Plugins;

namespace Claw.Emby.CustomItemUI
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        public bool Enabled { get; set; } = true;

        public bool EnableMoveLinksUp { get; set; } = true;
        public string LinksInsertAfter { get; set; } = "recordingEditor";
        public int LinksOrder { get; set; } = 8;
        public bool HideLinksHeading { get; set; } = true;
        public bool AlignLinksLeft { get; set; } = true;
        public bool RemoveLinkCommas { get; set; } = true;
        public string LinksGap { get; set; } = ".5em";

        public bool EnableVlcPathLinks { get; set; } = true;
        public string VlcUrlTemplate { get; set; } = "cvlc:///file:///{path}";
        public bool ShowVlcIcon { get; set; } = true;

        public bool EnableRaisedLinkButtons { get; set; } = true;
        public string ButtonBorderRadius { get; set; } = "1.5em";
        public string ButtonTextColor { get; set; } = "#ffffff";
        public string ButtonCustomCss { get; set; } = "";

        /// <summary>all | admins | allowlist</summary>
        public string ApplyMode { get; set; } = "all";
        public string AllowedUserNames { get; set; } = "";
        public string AllowedUserIds { get; set; } = "";

        // ---- Dashboard layout (v1.1) ----
        /// <summary>Rearrange the admin Dashboard home page. Off = Emby's stock layout, untouched.</summary>
        public bool EnableDashboardLayout { get; set; } = true;

        /// <summary>
        /// Section placement. null/empty = built-in preset. An array (not List) on purpose:
        /// XmlSerializer appends to pre-filled lists, which would duplicate entries on every load.
        /// </summary>
        public DashboardSectionLayout[] DashboardSections { get; set; }

        /// <summary>Below this viewport width (px) all sections stack in one column.</summary>
        public int DashboardStackBelowPx { get; set; } = 960;

        /// <summary>Sections in a row grow to fill space left by hidden siblings (e.g. Running tasks not running).</summary>
        public bool DashboardFillRows { get; set; } = true;

        /// <summary>Alerts entries shown (Emby default 4).</summary>
        public int DashboardAlertsLimit { get; set; } = 4;

        /// <summary>Activity entries shown (Emby default 10).</summary>
        public int DashboardActivityLimit { get; set; } = 10;

        /// <summary>Now playing cards per row; 0 = Emby automatic (min 22em per card).</summary>
        public int DashboardNowPlayingPerRow { get; set; } = 0;

        /// <summary>v1.2: render dashboard Activity as a table (Emby's list kept as fallback).</summary>
        public bool DashboardActivityTable { get; set; } = true;

        /// <summary>v1.2: render dashboard Alerts as a table.</summary>
        public bool DashboardAlertsTable { get; set; } = true;
    }

    public class DashboardSectionLayout
    {
        /// <summary>maintenance | serverinfo | alerts | nowplaying | runningtasks | recordings | activity</summary>
        public string Id { get; set; }
        public int Row { get; set; } = 1;
        public int Order { get; set; } = 1;
        /// <summary>Width in twelfths (1-12).</summary>
        public int Span { get; set; } = 12;
        public bool Visible { get; set; } = true;
    }
}
