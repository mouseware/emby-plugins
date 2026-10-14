using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace Claw.Emby.MediaIntegrity.Core
{
    /// <summary>Recommended skip list (1.0.5): Emby/Kodi metadata and artwork plus download/OS junk. Subtitles, media and ebooks stay hashed.</summary>
    public static class SkipDefaults
    {
        public static readonly string[] Recommended =
        {
            "*.nfo", "*.nfo-orig", "*.xml", "*.bif", "*.metathumb",
            "*.jpg", "*.jpeg", "*.png", "*.webp", "*.tbn", "*.gif",
            "Thumbs.db", "desktop.ini", ".DS_Store", "*.tmp", "*.part", "*.partial", "*.crdownload", "*.!qB"
        };
    }

    public sealed class DiscoveryResult
    {
        public DateTime Time { get; set; }
        public string Reason { get; set; }
        public int Roots { get; set; }
        public int RootsOffline { get; set; }
        public long OnDisk { get; set; }
        public long Added { get; set; }
        public long Removed { get; set; }
        /// <summary>Tracked rows dropped because they match the skip patterns (with their history; files on disk untouched).</summary>
        public long Skipped { get; set; }
        public double Seconds { get; set; }
        public List<string> Errors { get; set; } = new List<string>();
    }

    /// <summary>
    /// Disk enumeration cache. Every file on disk under the roots that the database does not know yet is
    /// recorded as "pending" (not yet hashed, no baseline), so it shows in Browse, search, filters and counts and
    /// can be checked by id like any other file. Pending rows that never got a hash and whose file is gone again
    /// are dropped (they never had a baseline, so they are not "missing"). Offline roots are left untouched.
    /// </summary>
    public static class FileDiscovery
    {
        public static DiscoveryResult Run(IntegrityStore store, IList<ScanRoot> roots, Regex exclude, string reason, CancellationToken ct, Func<DateTime> now = null)
        {
            now = now ?? (() => DateTime.UtcNow);
            var t0 = DateTime.UtcNow;
            var res = new DiscoveryResult { Time = now(), Reason = reason };
            res.Skipped = store.RemoveSkipped(exclude);
            foreach (var r in ScanEngine.DistinctRoots(roots))
            {
                ct.ThrowIfCancellationRequested();
                res.Roots++;
                bool online; try { online = Directory.Exists(r.Path); } catch { online = false; }
                if (!online) { res.RootsOffline++; continue; }
                var found = ScanEngine.Enumerate(r.Path, exclude, ct, res.Errors);
                res.OnDisk += found.Count;
                var (a, d) = store.SyncDiscovered(r.Path, found, now());
                res.Added += a; res.Removed += d;
            }
            res.Seconds = (DateTime.UtcNow - t0).TotalSeconds;
            return res;
        }
    }
}
