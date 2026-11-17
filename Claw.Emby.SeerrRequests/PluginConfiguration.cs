using System;
using MediaBrowser.Model.Plugins;

namespace Claw.Emby.SeerrRequests
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        /// <summary>Master switch (General tab). Off: the item-menu entry is hidden and new requests are refused. Activity and settings are kept.</summary>
        public bool Enabled { get; set; } = true;

        /// <summary>Seerr / Jellyseerr base URL, no trailing slash required.</summary>
        public string SeerrUrl { get; set; } = "http://192.168.1.237:5055";

        /// <summary>Seerr API key. Never logged and never returned unmasked to the web UI.</summary>
        public string ApiKey { get; set; } = "";

        /// <summary>all | admins | allowlist — who sees "Request this now".</summary>
        public string VisibilityMode { get; set; } = "all";

        /// <summary>Emby user ids allowed when VisibilityMode is allowlist. An array so XmlSerializer does not append on reload.</summary>
        public string[] AllowedUserIds { get; set; } = Array.Empty<string>();

        /// <summary>Optional extra allowlist by user name (case-insensitive).</summary>
        public string[] AllowedUserNames { get; set; } = Array.Empty<string>();

        /// <summary>Emby library / channel ids where the menu is shown. Empty = every library and the Trailers channel.</summary>
        public string[] AllowedLibraryIds { get; set; } = Array.Empty<string>();

        /// <summary>Manual Emby-user to Seerr-user mappings. Manual rows win over auto-match. Never used as an admin fallback.</summary>
        public UserMapEntry[] UserMaps { get; set; } = Array.Empty<UserMapEntry>();
    }

    public class UserMapEntry
    {
        public string EmbyUserId { get; set; }
        public string EmbyUserName { get; set; }
        /// <summary>Seerr numeric user id, as a string.</summary>
        public string SeerrUserId { get; set; }
        public string SeerrUserName { get; set; }
        /// <summary>manual | auto (auto is display-only; the saved overrides are manual).</summary>
        public string Mode { get; set; } = "manual";
    }
}
