using System;
using System.Collections.Generic;
using System.Linq;

namespace Claw.Emby.Guard.Core
{
    /// <summary>
    /// Pure merge of Guard's bans into Emby's Remote IP filter (ServerConfiguration.RemoteIPFilter +
    /// IsRemoteIPFilterBlacklist). Entries Guard did not write are "manual" and always kept.
    /// </summary>
    public static class FilterSync
    {
        public class Input
        {
            public string[] Current { get; set; } = Array.Empty<string>();
            public bool CurrentIsBlacklist { get; set; }
            public List<string> Owned { get; set; } = new List<string>();
            public bool? OriginalBlacklistMode { get; set; }
            public List<string> Desired { get; set; } = new List<string>();
            public bool Enabled { get; set; }
        }

        public class Output
        {
            public bool Changed { get; set; }
            public string[] NewFilter { get; set; }
            public bool NewIsBlacklist { get; set; }
            public List<string> NewOwned { get; set; }
            public bool? NewOriginalBlacklistMode { get; set; }
            /// <summary>"enforcing", "off", "conflict-whitelist" (Emby filter is an allow-list with entries: Guard refuses to flip it).</summary>
            public string State { get; set; }
            public int ManualCount { get; set; }
        }

        public static Output Compute(Input i)
        {
            var cmp = StringComparer.OrdinalIgnoreCase;
            var current = (i.Current ?? Array.Empty<string>()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).ToList();
            var owned = new HashSet<string>(i.Owned ?? new List<string>(), cmp);
            var manual = current.Where(x => !owned.Contains(x)).Distinct(cmp).ToList();
            var o = new Output { NewOwned = owned.ToList(), NewOriginalBlacklistMode = i.OriginalBlacklistMode, ManualCount = manual.Count };

            if (!i.Enabled)
            {
                // Master off: remove only Guard's entries; restore the original mode when nothing manual is left.
                o.NewFilter = manual.ToArray();
                o.NewIsBlacklist = i.CurrentIsBlacklist;
                if (manual.Count == 0 && i.OriginalBlacklistMode.HasValue) o.NewIsBlacklist = i.OriginalBlacklistMode.Value;
                if (manual.Count == 0) o.NewOriginalBlacklistMode = null;
                o.NewOwned = new List<string>();
                o.State = "off";
            }
            else if (!i.CurrentIsBlacklist && manual.Count > 0)
            {
                // Emby filter is a WHITELIST with admin entries: flipping it would turn "allowed" into "banned".
                o.NewFilter = current.ToArray();
                o.NewIsBlacklist = false;
                o.State = "conflict-whitelist";
            }
            else
            {
                var desired = (i.Desired ?? new List<string>()).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(cmp).ToList();
                if (!i.CurrentIsBlacklist && o.NewOriginalBlacklistMode == null) o.NewOriginalBlacklistMode = false;
                o.NewFilter = manual.Concat(desired.Where(d => !manual.Contains(d, cmp))).ToArray();
                o.NewIsBlacklist = true;
                o.NewOwned = desired.Where(d => !manual.Contains(d, cmp)).ToList();
                o.State = "enforcing";
            }
            o.Changed = o.NewIsBlacklist != i.CurrentIsBlacklist || !o.NewFilter.SequenceEqual(current, cmp);
            return o;
        }
    }
}
