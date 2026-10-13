using MediaBrowser.Model.Plugins;

namespace Claw.Emby.DefaultChapters
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        /// <summary>Spacing of generated chapters, in minutes (1-60). Emby's own default is 5.</summary>
        public int IntervalMinutes { get; set; } = 5;

        // ---- "Found movies" tab (v1.1): manual scan criteria, remembered between visits ----

        /// <summary>Only list movies longer than this many minutes.</summary>
        public int MinRuntimeMinutes { get; set; } = 60;

        /// <summary>Only list movies with this many chapters or fewer (chapter-type entries; markers not counted).</summary>
        public int MaxChapters { get; set; } = 3;

        /// <summary>Hide movies that already have interval chapters from this plugin.</summary>
        public bool ExcludeOverridden { get; set; } = true;
    }
}
