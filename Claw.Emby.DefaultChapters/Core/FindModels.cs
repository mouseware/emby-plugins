using System.Collections.Generic;

namespace Claw.Emby.DefaultChapters.Core
{
    public class FindCriteria
    {
        public int MinRuntimeMinutes { get; set; } = 60;
        public int MaxChapters { get; set; } = 3;
        public bool ExcludeOverridden { get; set; } = true;

        public FindCriteria Normalized()
        {
            return new FindCriteria
            {
                MinRuntimeMinutes = MinRuntimeMinutes < 0 ? 0 : (MinRuntimeMinutes > 1440 ? 1440 : MinRuntimeMinutes),
                MaxChapters = MaxChapters < 0 ? 0 : (MaxChapters > 999 ? 999 : MaxChapters),
                ExcludeOverridden = ExcludeOverridden
            };
        }
    }

    public class FoundMovie
    {
        public string Id { get; set; }
        public string ItemGuid { get; set; }
        public string Name { get; set; }
        public int? ProductionYear { get; set; }
        public string Path { get; set; }
        public long RunTimeTicks { get; set; }
        public int ChapterCount { get; set; }
        public int MarkerCount { get; set; }
        public bool HasOverride { get; set; }
        public bool LooksInterval { get; set; }
        public int DetectedIntervalMinutes { get; set; }
        /// <summary>True when Generate would ask for confirmation (override exists or interval-looking set).</summary>
        public bool NeedsConfirm { get; set; }
        public string ConfirmReason { get; set; }
        /// <summary>False when the runtime is shorter than one interval (Generate would be refused).</summary>
        public bool CanGenerate { get; set; }
    }

    public class FindResult
    {
        public FindCriteria Criteria { get; set; }
        public int IntervalMinutes { get; set; }
        /// <summary>Eligible movies above the runtime threshold that were inspected.</summary>
        public int ScannedCount { get; set; }
        public int MatchCount { get; set; }
        public bool Truncated { get; set; }
        public long ElapsedMs { get; set; }
        public List<FoundMovie> Items { get; set; }
    }

    public class BulkItemResult
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public bool Changed { get; set; }
        public bool NeedsConfirm { get; set; }
        public string ConfirmReason { get; set; }
        public string Error { get; set; }
        public OverrideRow Row { get; set; }
    }

    public class BulkGenerateResult
    {
        public int ChangedCount { get; set; }
        public int FailedCount { get; set; }
        public int NeedsConfirmCount { get; set; }
        public List<BulkItemResult> Results { get; set; }
    }
}
