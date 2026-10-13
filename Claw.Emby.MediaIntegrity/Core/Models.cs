using System;
using System.Collections.Generic;

namespace Claw.Emby.MediaIntegrity.Core
{
    public static class FileStatus
    {
        public const string Pending = "pending";          // known, waiting for its first hash (queued / just added)
        public const string NeverHashed = "never_hashed"; // imported from the old database without any hash history
        public const string Ok = "ok";                    // last check matched the baseline
        public const string Changed = "changed";          // hash differs but size and modified time did not change: silent corruption
        public const string Modified = "modified";        // hash differs and size/modified time changed: the file was rewritten
        public const string Missing = "missing";          // not found by the last complete scan (root online)
        public const string Unreadable = "unreadable";    // read error while hashing
        public static readonly string[] Problems = { Changed, Modified, Missing, Unreadable };
        public static bool IsProblem(string s) => Array.IndexOf(Problems, s) >= 0;
    }

    public static class CheckResult
    {
        public const string Baseline = "baseline", Match = "match", Changed = "changed", Modified = "modified", ModifiedAccepted = "modified-accepted",
            Missing = "missing", Unreadable = "unreadable", Accepted = "accepted", Legacy = "legacy-match", LegacyDiffers = "legacy-differs";
    }

    public class FileRecord
    {
        public long Id { get; set; }
        public string Path { get; set; }
        public string Folder { get; set; }
        public string Name { get; set; }
        public string Ext { get; set; }
        public long? Size { get; set; }
        public DateTime? Mtime { get; set; }
        public string BaselineMd5 { get; set; }
        public long? BaselineSize { get; set; }
        public DateTime? BaselineMtime { get; set; }
        public DateTime? BaselineDate { get; set; }
        public string LastMd5 { get; set; }
        public DateTime? LastChecked { get; set; }
        public string LastResult { get; set; }
        public string Status { get; set; }
        public bool Ignored { get; set; }
        public DateTime? FirstSeen { get; set; }
        public DateTime? LastSeen { get; set; }
        public long? LastScanId { get; set; }
        public long? LegacyId { get; set; }
        public string Error { get; set; }
    }

    public class CheckRecord
    {
        public long Id { get; set; }
        public long FileId { get; set; }
        public DateTime Time { get; set; }
        public string Md5 { get; set; }
        public long? Size { get; set; }
        public double? Seconds { get; set; }
        public string Result { get; set; }
        public string Source { get; set; }
        public long? ScanId { get; set; }
        public string Note { get; set; }
    }

    public class ScanRecord
    {
        public long Id { get; set; }
        public string Kind { get; set; }
        /// <summary>running | paused | stopped | interrupted | completed | failed | abandoned</summary>
        public string State { get; set; }
        public DateTime Started { get; set; }
        public DateTime? Ended { get; set; }
        public long Total { get; set; }
        public long Done { get; set; }
        public long BytesTotal { get; set; }
        public long BytesDone { get; set; }
        public long Matched { get; set; }
        public long Changed { get; set; }
        public long Modified { get; set; }
        public long New { get; set; }
        public long Missing { get; set; }
        public long Unreadable { get; set; }
        public string Position { get; set; }
        public string Roots { get; set; }
        public string Note { get; set; }
        public double ActiveSeconds { get; set; }
        public double BytesHashed { get; set; }
        /// <summary>What was checked ("Full integrity scan", "Sintel (2010)", "Movies", "3 selected files + 1 more batch", "New media Oct 13").</summary>
        public string Label { get; set; }
        /// <summary>full: scheduled | manual. manual/item: the button used. newmedia: daily rollup.</summary>
        public string Trigger { get; set; }
    }

    public class ScanRoot
    {
        public string Path { get; set; }
        /// <summary>Library name, or "Extra folder".</summary>
        public string Label { get; set; }
        public ScanRoot() { }
        public ScanRoot(string path, string label) { Path = path; Label = label; }
    }

    public class ImportResult
    {
        public bool Ran { get; set; }
        public string Source { get; set; }
        public string Error { get; set; }
        public DateTime? Time { get; set; }
        public long SourceFiles { get; set; }
        public long SourceHashes { get; set; }
        public long FilesImported { get; set; }
        public long ChecksImported { get; set; }
        public long CaseDuplicatesMerged { get; set; }
        public long AlreadyPresent { get; set; }
        public long Ok { get; set; }
        public long Changed { get; set; }
        public long NeverHashed { get; set; }
        public long HistoricMismatches { get; set; }
        public DateTime? OldestCheck { get; set; }
        public DateTime? NewestCheck { get; set; }
        public double Seconds { get; set; }
    }

    public class GroupSummary
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public string[] Paths { get; set; }
        public long Files { get; set; }
        public long Bytes { get; set; }
        public long Ok { get; set; }
        public long Problems { get; set; }
        public long Pending { get; set; }
        public DateTime? OldestCheck { get; set; }
        public DateTime? NewestCheck { get; set; }
    }

    public class PagedFiles
    {
        public long Total { get; set; }
        public int Offset { get; set; }
        public List<FileRecord> Items { get; set; }
    }
}
