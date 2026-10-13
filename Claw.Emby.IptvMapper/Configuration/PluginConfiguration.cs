using System;
using MediaBrowser.Model.Plugins;

namespace Claw.Emby.IptvMapper.Configuration
{
    /// <summary>
    /// Stored by Emby as XML under plugins\configurations. Written by the web page
    /// (ApiClient.updatePluginConfiguration) after a successful batch save.
    /// </summary>
    public class PluginConfiguration : BasePluginConfiguration
    {
        public int SchemaVersion { get; set; } = 3;

        /// <summary>One record per stable key (tunerHostId|tvg:&lt;id&gt; or tunerHostId|name:&lt;normalized&gt;).</summary>
        public ChannelOverride[] Overrides { get; set; } = Array.Empty<ChannelOverride>();

        /// <summary>Newest first. Trimmed to MaxSnapshots by the page.</summary>
        public MappingSnapshot[] Snapshots { get; set; } = Array.Empty<MappingSnapshot>();

        public int MaxSnapshots { get; set; } = 10;
    }

    public class ChannelOverride
    {
        public string Key { get; set; }
        public string TunerHostId { get; set; }

        // Desired values. null = not overridden by this plugin.
        public string Number { get; set; }
        public string Name { get; set; }
        public string LogoUrl { get; set; }
        /// <summary>v1.1: logo copied from another channel's Primary image (item id at the time of the copy).</summary>
        public string LogoSourceItemId { get; set; }
        /// <summary>v1.1: stable key of the logo source channel (survives re-keying better than the item id).</summary>
        public string LogoSourceKey { get; set; }
        /// <summary>v1.2: "upload" = image uploaded from the browser's computer (data is never stored here); null otherwise.</summary>
        public string LogoSource { get; set; }
        /// <summary>v1.2: original file name of the uploaded logo.</summary>
        public string LogoFileName { get; set; }
        /// <summary>v1.1: custom group (TvChannel Tags, locked). null = M3U group (no Tags lock).</summary>
        public string Group { get; set; }
        public bool HasGuideOverride { get; set; }
        /// <summary>"" = Auto, "none" = no guide, otherwise a listings provider id.</summary>
        public string ListingsProviderId { get; set; }
        public string ListingsChannelId { get; set; }
        public bool? Disabled { get; set; }

        // Last-known Emby identity (re-resolved from Key on every load).
        public string ManagementId { get; set; }
        public string ItemId { get; set; }

        // Provider (M3U) values seen at the time of the edit, for a future "source changed" flag.
        public string SeenTvgId { get; set; }
        public string SeenM3uName { get; set; }
        public string SeenM3uNumber { get; set; }
        public string SeenM3uGroup { get; set; }
        public string SeenM3uLogoUrl { get; set; }

        public string UpdatedUtc { get; set; }
    }

    public class MappingSnapshot
    {
        public string Id { get; set; }
        public string DateUtc { get; set; }
        public string Summary { get; set; }
        public SnapshotChange[] Changes { get; set; } = Array.Empty<SnapshotChange>();
    }

    public class SnapshotChange
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public string ItemId { get; set; }
        public string ManagementId { get; set; }
        /// <summary>number | name | group | logo | guide | enabled. Logo values: "" / URL / "copy:&lt;itemId&gt;" / "upload:&lt;filename&gt;".</summary>
        public string Field { get; set; }
        public string Before { get; set; }
        public string After { get; set; }
    }
}
