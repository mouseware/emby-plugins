using System;
using System.Collections.Generic;
using System.Linq;
using Claw.Emby.MediaIntegrity.Core;
using Claw.Emby.MediaIntegrity.Server;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Services;

namespace Claw.Emby.MediaIntegrity.Api
{
    [Route("/ClawMediaIntegrity/Status", "GET", Summary = "Media Integrity: scan progress, queue, counts, import result")]
    [Authenticated(Roles = "Admin")]
    public class GetStatus : IReturn<StatusResult> { }

    [Route("/ClawMediaIntegrity/Scan/{Action}", "POST", Summary = "Media Integrity: Start | StartFresh | Pause | Resume | Stop the full scan")]
    [Authenticated(Roles = "Admin")]
    public class PostScanAction : IReturn<OkResult> { public string Action { get; set; } }

    [Route("/ClawMediaIntegrity/Problems", "GET", Summary = "Media Integrity: changed / modified / missing / unreadable files")]
    [Authenticated(Roles = "Admin")]
    public class GetProblems : IReturn<List<FileDto>> { public bool IncludeIgnored { get; set; } }

    [Route("/ClawMediaIntegrity/Files/Action", "POST", Summary = "Media Integrity: accept | recheck | ignore | unignore | forget for file ids (comma separated)")]
    [Authenticated(Roles = "Admin")]
    public class PostFilesAction : IReturn<ActionResult> { public string Ids { get; set; } public string Action { get; set; } }

    [Route("/ClawMediaIntegrity/Groups", "GET", Summary = "Media Integrity: summary rows grouped by library or by drive/folder")]
    [Authenticated(Roles = "Admin")]
    public class GetGroups : IReturn<List<GroupSummary>> { public string GroupBy { get; set; } }

    [Route("/ClawMediaIntegrity/Files", "GET", Summary = "Media Integrity: files of one group, searchable and paged")]
    [Authenticated(Roles = "Admin")]
    public class GetFiles : IReturn<PagedDto>
    {
        public string GroupBy { get; set; }
        public string Group { get; set; }
        public string Search { get; set; }
        public string Status { get; set; }
        public string Sort { get; set; }
        public bool Desc { get; set; }
        public int StartIndex { get; set; }
        public int Limit { get; set; } = 100;
    }

    [Route("/ClawMediaIntegrity/Files/{Id}/History", "GET", Summary = "Media Integrity: one file with its check history")]
    [Authenticated(Roles = "Admin")]
    public class GetHistory : IReturn<HistoryDto> { public long Id { get; set; } }

    [Route("/ClawMediaIntegrity/Scans", "GET", Summary = "Media Integrity: past scans")]
    [Authenticated(Roles = "Admin")]
    public class GetScans : IReturn<List<ScanRecord>> { public int Limit { get; set; } = 100; }

    [Route("/ClawMediaIntegrity/Scans/{Id}", "GET", Summary = "Media Integrity: one Activity entry with the files it found problems in")]
    [Authenticated(Roles = "Admin")]
    public class GetScan : IReturn<ScanDetail> { public long Id { get; set; } }
    public class ScanDetail { public ScanRecord Scan { get; set; } public List<FileDto> Findings { get; set; } public long Checks { get; set; } }

    [Route("/ClawMediaIntegrity/Libraries", "GET", Summary = "Media Integrity: Emby libraries and whether they are scanned")]
    [Authenticated(Roles = "Admin")]
    public class GetLibraries : IReturn<List<IntegrityHost.LibraryInfo>> { }

    [Route("/ClawMediaIntegrity/Import", "POST", Summary = "Media Integrity: import the legacy database now (adds files not yet known)")]
    [Authenticated(Roles = "Admin")]
    public class PostImport : IReturn<ImportResult> { }

    [Route("/ClawMediaIntegrity/Check/Items", "POST", Summary = "Media Integrity: check the files of library items now (Ids = comma separated item ids; folders recursively)")]
    [Authenticated(Roles = "Admin")]
    public class PostCheckItems : IReturn<CheckJob> { public string Ids { get; set; } }

    [Route("/ClawMediaIntegrity/Check/Files", "POST", Summary = "Media Integrity: check tracked files now (Ids = comma separated file ids)")]
    [Authenticated(Roles = "Admin")]
    public class PostCheckFiles : IReturn<CheckJob> { public string Ids { get; set; } }

    [Route("/ClawMediaIntegrity/Check/Group", "POST", Summary = "Media Integrity: check a Browse group (library / drive folder) now")]
    [Authenticated(Roles = "Admin")]
    public class PostCheckGroup : IReturn<CheckJob> { public string GroupBy { get; set; } public string Group { get; set; } }

    [Route("/ClawMediaIntegrity/Check/Jobs", "GET", Summary = "Media Integrity: manual check jobs (newest first)")]
    [Authenticated(Roles = "Admin")]
    public class GetCheckJobs : IReturn<List<CheckJob>> { }

    [Route("/ClawMediaIntegrity/Check/Jobs/{Id}", "GET", Summary = "Media Integrity: one manual check job")]
    [Authenticated(Roles = "Admin")]
    public class GetCheckJob : IReturn<CheckJob> { public long Id { get; set; } public int Since { get; set; } }

    [Route("/ClawMediaIntegrity/Check/Cancel", "POST", Summary = "Media Integrity: cancel the running and queued manual checks")]
    [Authenticated(Roles = "Admin")]
    public class PostCheckCancel : IReturn<OkResult> { }

    [Route("/ClawMediaIntegrity/FileList/Refresh", "POST", Summary = "Media Integrity: re-read the library folders from disk now (files not in the database are listed as not yet hashed)")]
    [Authenticated(Roles = "Admin")]
    public class PostFileListRefresh : IReturn<OkResult> { }

    [Route("/ClawMediaIntegrity/Check/Matching", "POST", Summary = "Media Integrity: check every file matching a Browse / Problems filter (select all N matching)")]
    [Authenticated(Roles = "Admin")]
    public class PostCheckMatching : IReturn<CheckJob>
    {
        /// <summary>Browse group key ("all", "other", "lib:..", a folder) or "problems" for the Problems tab.</summary>
        public string Group { get; set; }
        public string GroupBy { get; set; }
        public string Search { get; set; }
        public string Status { get; set; }
        public bool IncludeIgnored { get; set; }
        /// <summary>Only count, do not queue (for the confirmation above 2,000 files).</summary>
        public bool CountOnly { get; set; }
    }

    public class DiscoveryStatus { public bool Running { get; set; } public DateTime? Scheduled { get; set; } public DiscoveryResult Last { get; set; } }

    public class ManualStatus
    {
        public bool Active { get; set; }
        public CheckJob Job { get; set; }
        public int QueuedJobs { get; set; }
        public int PendingFiles { get; set; }
        public double BytesPerSecond { get; set; }
        public double? SecondsLeft { get; set; }
        public CheckJob LastFinished { get; set; }
    }

    public class OkResult { public bool Ok { get; set; } public string Error { get; set; } }
    public class ActionResult { public int Done { get; set; } public int Skipped { get; set; } public string Error { get; set; } public long? JobId { get; set; } }

    public class FileDto
    {
        public long Id { get; set; }
        public string Path { get; set; }
        public string Name { get; set; }
        public string Folder { get; set; }
        public long? Size { get; set; }
        public string Hash { get; set; }
        public string LastHash { get; set; }
        public DateTime? LastChecked { get; set; }
        public DateTime? BaselineDate { get; set; }
        public string Status { get; set; }
        public string LastResult { get; set; }
        public bool Ignored { get; set; }
        public string Error { get; set; }
        public DateTime? Mtime { get; set; }
        public static FileDto From(FileRecord f) => new FileDto
        {
            Id = f.Id, Path = f.Path, Name = f.Name, Folder = f.Folder, Size = f.Size, Hash = f.BaselineMd5, LastHash = f.LastMd5, LastChecked = f.LastChecked, BaselineDate = f.BaselineDate,
            Status = f.Status, LastResult = f.LastResult, Ignored = f.Ignored, Error = f.Error, Mtime = f.Mtime
        };
    }
    public class PagedDto { public long Total { get; set; } public int StartIndex { get; set; } public List<FileDto> Items { get; set; } }
    public class HistoryDto { public FileDto File { get; set; } public List<CheckRecord> Checks { get; set; } }

    public class StatusResult
    {
        public string State { get; set; }
        public string PauseReason { get; set; }
        public bool UserPaused { get; set; }
        public long ScanId { get; set; }
        public long FileIndex { get; set; }
        public long FileCount { get; set; }
        public string CurrentFile { get; set; }
        public long CurrentSize { get; set; }
        public long CurrentDone { get; set; }
        public long BytesDone { get; set; }
        public long BytesTotal { get; set; }
        public double BytesPerSecond { get; set; }
        public double? SecondsLeft { get; set; }
        public double Percent { get; set; }
        public long Matched { get; set; }
        public long Changed { get; set; }
        public long Modified { get; set; }
        public long New { get; set; }
        public long Missing { get; set; }
        public long Unreadable { get; set; }
        public DateTime? Started { get; set; }
        public ScanRecord Resumable { get; set; }
        public ScanRecord LastScan { get; set; }
        public long QueueLength { get; set; }
        public string QueueCurrent { get; set; }
        public bool PlaybackActive { get; set; }
        public Dictionary<string, long> Counts { get; set; }
        public long Files { get; set; }
        public long Problems { get; set; }
        public ImportResult Import { get; set; }
        public string LastSkipReason { get; set; }
        public DateTime? LastCompleteVerification { get; set; }
        public int RootCount { get; set; }
        public DateTime Now { get; set; }
        public DiscoveryStatus FileList { get; set; }
        public ManualStatus Manual { get; set; }
    }

    public class IntegrityService : IService
    {
        private static IntegrityHost H => IntegrityHost.Instance ?? throw new InvalidOperationException("Media Integrity is starting");

        public object Get(GetStatus r)
        {
            var h = H; var p = h.Progress; var counts = h.Store.StatusCounts();
            var scans = h.Store.Scans(50);
            return new StatusResult
            {
                State = h.ScanRunning ? p.State : "idle", PauseReason = p.PauseReason, UserPaused = h.ScanGate.UserPaused, ScanId = p.ScanId,
                FileIndex = p.FileIndex, FileCount = p.FileCount, CurrentFile = p.CurrentFile, CurrentSize = p.CurrentSize, CurrentDone = p.CurrentDone,
                BytesDone = p.BytesDone, BytesTotal = p.BytesTotal, BytesPerSecond = p.BytesPerSecond, SecondsLeft = p.SecondsLeft, Percent = Math.Round(p.Percent, 2),
                Matched = p.Matched, Changed = p.Changed, Modified = p.Modified, New = p.New, Missing = p.Missing, Unreadable = p.Unreadable, Started = p.Started,
                Resumable = h.ScanRunning ? null : h.Store.ResumableScan("full"), LastScan = scans.FirstOrDefault(x => x.Kind == "full"),
                QueueLength = h.Store.QueueLength, QueueCurrent = h.QueueCurrent, PlaybackActive = h.IsPlaybackActive(),
                Counts = counts, Files = h.Store.FileCount, Problems = FileStatus.Problems.Sum(s => counts.TryGetValue(s, out var n) ? n : 0),
                Import = h.Import, LastSkipReason = h.LastSkipReason, LastCompleteVerification = h.LastCompleteVerification(), RootCount = h.Roots().Count, Now = DateTime.UtcNow,
                FileList = new DiscoveryStatus { Running = h.Discovering, Scheduled = h.DiscoveryRequested, Last = h.LastDiscovery },
                Manual = ManualStatusOf(h)
            };
        }

        public static ManualStatus ManualStatusOf(IntegrityHost h)
        {
            var m = h.Manual; if (m == null) return new ManualStatus();
            var cur = m.Current; var rate = m.BytesPerSecond;
            long left = 0;
            foreach (var j in m.Jobs().Where(j => j.State == "queued" || j.State == "running")) left += Math.Max(0, j.BytesTotal - j.BytesDone);
            return new ManualStatus
            {
                Active = cur != null || m.QueuedJobs > 0, Job = cur, QueuedJobs = m.QueuedJobs, PendingFiles = m.PendingFiles, BytesPerSecond = rate,
                SecondsLeft = rate > 1 && cur != null ? left / rate : (double?)null,
                LastFinished = m.Jobs().FirstOrDefault(j => j.State == "done" || j.State == "cancelled")
            };
        }

        private static List<long> ParseIds(string ids) => (ids ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(s => long.TryParse(s.Trim(), out var v) ? v : -1).Where(v => v >= 0).ToList();

        public object Post(PostCheckItems r) => H.CheckItems((r.Ids ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()));

        public object Post(PostCheckFiles r)
        {
            var h = H;
            var paths = ParseIds(r.Ids).Select(id => h.Store.GetFile(id)).Where(f => f != null).Select(f => f.Path).ToList();
            var label = paths.Count == 1 ? System.IO.Path.GetFileName(paths[0]) : paths.Count + " selected files";
            return h.CheckPaths(label, paths, null, false);
        }

        public object Post(PostCheckGroup r)
        {
            var h = H;
            var groups = Groups(h, r.GroupBy, out var allRoots);
            if (r.Group == "pending") return h.Snap(h.Manual.Enqueue("All files not yet hashed", h.Store.PendingPaths()));
            if (r.Group == "other") return h.Snap(h.Manual.Enqueue("Not in scope (old paths)", h.Store.PathsUnder(null, allRoots)));
            var g = groups.FirstOrDefault(x => x.Key == r.Group);
            if (g == null) return h.Snap(h.Manual.Enqueue("(unknown group)", new string[0]));
            return h.CheckPaths(g.Label, null, g.Paths, false);
        }

        public object Get(GetCheckJobs r) => H.Manual.Jobs();
        public object Get(GetCheckJob r) => (object)H.Manual.Get(r.Id, r.Since) ?? new CheckJob { Id = r.Id, State = "unknown" };
        public object Post(PostCheckCancel r) { H.Manual.CancelAll(); return new OkResult { Ok = true }; }

        public object Post(PostScanAction r)
        {
            var h = H;
            switch ((r.Action ?? "").ToLowerInvariant())
            {
                case "start": h.RequestStart(false); break;
                case "startfresh": if (h.ScanRunning) return new OkResult { Error = "Stop the running scan first." }; h.RequestStart(true); break;
                case "pause": h.Pause(); break;
                case "resume": h.Resume(); break;
                case "stop": h.Stop(); break;
                default: return new OkResult { Error = "unknown action" };
            }
            return new OkResult { Ok = true };
        }

        public object Get(GetProblems r) => H.Store.Problems(r.IncludeIgnored).Select(FileDto.From).ToList();

        public object Post(PostFilesAction r)
        {
            var h = H; var res = new ActionResult(); var now = DateTime.UtcNow; var recheck = new List<string>();
            foreach (var s in (r.Ids ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (!long.TryParse(s.Trim(), out var id)) { res.Skipped++; continue; }
                var f = h.Store.GetFile(id);
                if (f == null) { res.Skipped++; continue; }
                switch ((r.Action ?? "").ToLowerInvariant())
                {
                    case "accept": if (h.Store.AcceptCurrent(id, now)) res.Done++; else res.Skipped++; break;
                    case "recheck": recheck.Add(f.Path); res.Done++; break;
                    case "ignore": h.Store.SetIgnored(id, true); res.Done++; break;
                    case "unignore": h.Store.SetIgnored(id, false); res.Done++; break;
                    case "forget": if (f.Status == FileStatus.Missing && h.Store.DeleteFile(id)) res.Done++; else res.Skipped++; break;
                    default: res.Error = "unknown action"; return res;
                }
            }
            if (recheck.Count > 0) res.JobId = h.CheckPaths(recheck.Count == 1 ? "Re-check " + System.IO.Path.GetFileName(recheck[0]) : "Re-check " + recheck.Count + " files", recheck, null, false).Id;
            return res;
        }

        // ---- grouping ----
        private sealed class Group { public string Key, Label; public List<string> Paths = new List<string>(); }

        private static List<Group> Groups(IntegrityHost h, string groupBy, out List<string> allRoots)
        {
            var list = new List<Group>();
            allRoots = new List<string>();
            if (string.Equals(groupBy, "folder", StringComparison.OrdinalIgnoreCase))
            {
                // drive + first folder level, from what is in the database (includes paths outside the current scope)
                foreach (var r in h.Store.Db.Query("SELECT DISTINCT folder FROM files"))
                {
                    var top = TopFolder(r.Str("folder"));
                    if (top != null && !list.Any(g => string.Equals(g.Key, top, StringComparison.OrdinalIgnoreCase))) list.Add(new Group { Key = top, Label = top, Paths = { top } });
                }
                list = list.OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase).ToList();
                allRoots.AddRange(list.Select(g => g.Key));
                return list;
            }
            foreach (var l in h.Libraries()) { list.Add(new Group { Key = "lib:" + l.Id, Label = l.Name + (l.Included ? "" : " (not scanned)"), Paths = l.Locations.ToList() }); allRoots.AddRange(l.Locations); }
            var extra = (IntegrityHost.Cfg.ExtraFolders ?? new string[0]).Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p.Trim()).ToList();
            if (extra.Count > 0) { list.Add(new Group { Key = "extra", Label = "Extra folders", Paths = extra }); allRoots.AddRange(extra); }
            return list;
        }

        public static string TopFolder(string folder)
        {
            if (string.IsNullOrEmpty(folder)) return null;
            var root = System.IO.Path.GetPathRoot(folder) ?? "";
            var rest = folder.Substring(root.Length).Trim('\\', '/');
            var first = rest.Split('\\', '/')[0];
            return first.Length == 0 ? root : System.IO.Path.Combine(root, first);
        }

        private static bool Under(string folder, IEnumerable<string> roots) => roots.Any(r =>
            string.Equals(folder.TrimEnd('\\', '/'), r.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase) || (folder + "\\").StartsWith(IntegrityStore.WithSep(r), StringComparison.OrdinalIgnoreCase));

        public object Get(GetGroups r)
        {
            var h = H;
            var groups = Groups(h, r.GroupBy, out var allRoots);
            var stats = h.Store.FolderStats();
            var outp = new List<GroupSummary>();
            GroupSummary Sum(string key, string label, string[] paths, IEnumerable<Row> rows)
            {
                var g = new GroupSummary { Key = key, Label = label, Paths = paths };
                foreach (var s in rows)
                {
                    g.Files += s.Long("n"); g.Bytes += s.Long("bytes"); g.Ok += s.Long("ok"); g.Problems += s.Long("problems"); g.Pending += s.Long("pending");
                    var o = Time.FromDb(s.Str("oldest")); var n = Time.FromDb(s.Str("newest"));
                    if (o != null && (g.OldestCheck == null || o < g.OldestCheck)) g.OldestCheck = o;
                    if (n != null && (g.NewestCheck == null || n > g.NewestCheck)) g.NewestCheck = n;
                }
                return g;
            }
            foreach (var g in groups) outp.Add(Sum(g.Key, g.Label, g.Paths.ToArray(), stats.Where(s => Under(s.Str("folder"), g.Paths))));
            var other = stats.Where(s => !Under(s.Str("folder"), allRoots)).ToList();
            if (other.Count > 0) outp.Add(Sum("other", "Not in scope (old paths)", new string[0], other));
            return outp;
        }

        public object Get(GetFiles r)
        {
            var h = H;
            var groups = Groups(h, r.GroupBy, out var allRoots);
            PagedFiles page;
            if (string.IsNullOrEmpty(r.Group) || r.Group == "all") page = h.Store.Browse(null, null, r.Search, r.Status, r.Sort, r.Desc, r.StartIndex, r.Limit);
            else if (r.Group == "other") page = h.Store.Browse(null, allRoots, r.Search, r.Status, r.Sort, r.Desc, r.StartIndex, r.Limit);
            else
            {
                var g = groups.FirstOrDefault(x => x.Key == r.Group);
                if (g == null) return new PagedDto { Items = new List<FileDto>() };
                page = h.Store.Browse(g.Paths, null, r.Search, r.Status, r.Sort, r.Desc, r.StartIndex, r.Limit);
            }
            return new PagedDto { Total = page.Total, StartIndex = page.Offset, Items = page.Items.Select(FileDto.From).ToList() };
        }

        public object Get(GetHistory r)
        {
            var h = H; var f = h.Store.GetFile(r.Id);
            if (f == null) return new HistoryDto { Checks = new List<CheckRecord>() };
            return new HistoryDto { File = FileDto.From(f), Checks = h.Store.History(r.Id) };
        }

        public object Get(GetScans r) => H.Store.Scans(Math.Max(1, Math.Min(r.Limit, 500)));
        public object Get(GetScan r)
        {
            var h = H; var sc = h.Store.GetScan(r.Id);
            if (sc == null) return new ScanDetail { Findings = new List<FileDto>() };
            return new ScanDetail { Scan = sc, Findings = h.Store.ScanFindings(r.Id, 200).Select(FileDto.From).ToList(), Checks = h.Store.Db.ScalarLong("SELECT COUNT(*) FROM checks WHERE scan_id=@s", ("s", r.Id)) };
        }
        public object Get(GetLibraries r) => H.Libraries();
        public object Post(PostImport r) => H.RunImport();
        public object Post(PostCheckMatching r)
        {
            var h = H;
            List<string> paths;
            string label;
            if (r.Group == "problems")
            {
                // same rows as the Problems tab: problem status (one kind or all), name/path filter, ignored only when shown
                var kinds = string.IsNullOrEmpty(r.Status) ? FileStatus.Problems : new[] { r.Status };
                paths = h.Store.Problems(r.IncludeIgnored, int.MaxValue).Where(f => kinds.Contains(f.Status))
                    .Where(f => string.IsNullOrWhiteSpace(r.Search) || (f.Path ?? "").IndexOf(r.Search.Trim(), StringComparison.OrdinalIgnoreCase) >= 0).Select(f => f.Path).ToList();
                label = "All matching problems";
            }
            else
            {
                var groups = Groups(h, r.GroupBy, out var allRoots);
                if (string.IsNullOrEmpty(r.Group) || r.Group == "all") { paths = h.Store.MatchingPaths(null, null, r.Search, r.Status); label = "All matching files"; }
                else if (r.Group == "other") { paths = h.Store.MatchingPaths(null, allRoots, r.Search, r.Status); label = "Not in scope (matching)"; }
                else
                {
                    var g = groups.FirstOrDefault(x => x.Key == r.Group);
                    paths = g == null ? new List<string>() : h.Store.MatchingPaths(g.Paths, null, r.Search, r.Status);
                    label = (g?.Label ?? "?") + (string.IsNullOrWhiteSpace(r.Search) && string.IsNullOrEmpty(r.Status) ? "" : " (matching)");
                }
            }
            if (r.CountOnly) return new CheckJob { Label = label, Total = paths.Count, State = "count" };
            return h.Snap(h.Manual.Enqueue(label, paths));
        }

        public object Post(PostFileListRefresh r) { H.RequestDiscovery("refresh button", 0); return new OkResult { Ok = true }; }
    }
}
