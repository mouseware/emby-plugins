using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace Claw.Emby.MediaIntegrity.Core
{
    public sealed class DiscoveryResult
    {
        public DateTime Time { get; set; }
        public string Reason { get; set; }
        public int Roots { get; set; }
        public int RootsOffline { get; set; }
        public long OnDisk { get; set; }
        public long Added { get; set; }
        public long Removed { get; set; }
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
