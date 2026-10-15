using System;
using MediaBrowser.Model.Plugins;

namespace Claw.Emby.MediaIntegrity
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        /// <summary>Hash files of newly added library items in the background (baseline).</summary>
        /// <summary>Master switch (General tab). Off: no scans, no background or manual hashing, no file-list refresh and no
        /// item-menu entry. Stored hashes and history are kept; queued new-item hashing resumes when switched on.</summary>
        public bool Enabled { get; set; } = true;
        public bool HashNewItems { get; set; } = true;
        /// <summary>Emby library ids (VirtualFolderInfo.ItemId) that are NOT scanned. Empty = every library.</summary>
        public string[] ExcludedLibraryIds { get; set; } = Array.Empty<string>();
        /// <summary>Extra folders scanned in addition to the library folders.</summary>
        public string[] ExtraFolders { get; set; } = Array.Empty<string>();
        /// <summary>Recommended skip list (1.0.5): Emby/Kodi metadata and artwork plus download/OS junk. Subtitles and all media stay hashed.</summary>
        public static string[] RecommendedExclude => Core.SkipDefaults.Recommended;
        /// <summary>File-name globs that are skipped: never hashed, not listed, and removed from tracking (with their history) when added here.</summary>
        public string[] Exclude { get; set; } = (string[])RecommendedExclude.Clone();
        /// <summary>When these were rewritten (size or modified time changed) the new hash is accepted silently. Emby/Kodi metadata files.</summary>
        public string[] AutoAcceptModifiedExtensions { get; set; } = { ".nfo", ".xml", ".jpg", ".jpeg", ".png", ".webp", ".tbn", ".bif" };
        /// <summary>Hashing speed limit in MB/s, 0 = unlimited.</summary>
        public int ThrottleMBps { get; set; } = 0;
        public bool PauseDuringPlayback { get; set; } = true;
        /// <summary>Scheduled / Emby-dashboard runs are skipped while the last complete verification (incl. the imported one) is newer than this. 0 = never skip. "Start scan" on the plugin page always runs.</summary>
        public int MinDaysBetweenScheduledScans { get; set; } = 182;
        public bool NotifyScanSummary { get; set; } = true;
        public bool NotifyProblems { get; set; } = true;
        /// <summary>Old get-all-hashes.ps1 database imported once on first start (copied, opened read-only; the original is never changed).</summary>
        public string LegacyDbPath { get; set; } = @"M:\filehashes.db";
    }
}
