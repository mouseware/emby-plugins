using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace Claw.Emby.MediaIntegrity.Core
{
    public class ScanOptions
    {
        /// <summary>File-name globs that are never hashed (e.g. Thumbs.db, *.tmp). Matched against the file name, case-insensitive.</summary>
        public string[] Exclude { get; set; } = Array.Empty<string>();
        /// <summary>Extensions whose rewrites (size/time changed) are accepted silently (Emby metadata: .nfo .jpg ...).</summary>
        public string[] AutoAcceptModifiedExtensions { get; set; } = Array.Empty<string>();
        public double MtimeToleranceSeconds { get; set; } = 2;
    }

    /// <summary>Live progress of the running scan (read by the API and the Emby task).</summary>
    public sealed class ScanProgress
    {
        private readonly object _l = new object();
        public string State { get; private set; } = "idle"; // idle | enumerating | hashing | paused | finishing
        public string PauseReason { get; private set; }
        public long ScanId { get; private set; }
        public long FileIndex { get; private set; }
        public long FileCount { get; private set; }
        public string CurrentFile { get; private set; }
        public long CurrentSize { get; private set; }
        public long CurrentDone { get; private set; }
        public long BytesDone { get; private set; }
        public long BytesTotal { get; private set; }
        public double BytesPerSecond { get; private set; }
        public long Matched, Changed, Modified, New, Missing, Unreadable;
        public DateTime? Started { get; private set; }
        public string Note { get; private set; }
        private DateTime _rateT; private long _rateB;

        public void Begin(ScanRecord s, DateTime now) { lock (_l) { State = "enumerating"; ScanId = s.Id; Started = s.Started; Copy(s); FileIndex = s.Done; BytesDone = s.BytesDone; BytesPerSecond = s.ActiveSeconds > 1 ? s.BytesHashed / s.ActiveSeconds : 0; _rateT = now; _rateB = 0; Note = null; } }
        public void Copy(ScanRecord s) { lock (_l) { Matched = s.Matched; Changed = s.Changed; Modified = s.Modified; New = s.New; Missing = s.Missing; Unreadable = s.Unreadable; FileCount = s.Total; BytesTotal = s.BytesTotal; } }
        public void SetState(string st, string reason = null) { lock (_l) { State = st; PauseReason = reason; } }
        public void SetNote(string n) { lock (_l) Note = n; }
        public void StartFile(long index, string path, long size) { lock (_l) { FileIndex = index; CurrentFile = path; CurrentSize = size; CurrentDone = 0; if (State != "paused") State = "hashing"; } }
        public void Bytes(long n, DateTime now)
        {
            lock (_l)
            {
                CurrentDone += n; BytesDone += n; _rateB += n;
                var dt = (now - _rateT).TotalSeconds;
                if (dt >= 2) { var r = _rateB / dt; BytesPerSecond = BytesPerSecond <= 0 ? r : BytesPerSecond * 0.7 + r * 0.3; _rateT = now; _rateB = 0; }
            }
        }
        public void ResetRateClock(DateTime now) { lock (_l) { _rateT = now; _rateB = 0; } }
        public void End() { lock (_l) { State = "idle"; PauseReason = null; CurrentFile = null; CurrentSize = CurrentDone = 0; } }

        public double Percent { get { lock (_l) { if (BytesTotal > 0) return Math.Min(100, BytesDone * 100.0 / BytesTotal); return FileCount > 0 ? FileIndex * 100.0 / FileCount : 0; } } }
        public double? SecondsLeft { get { lock (_l) { if (BytesPerSecond <= 1 || BytesTotal <= 0) return null; return Math.Max(0, (BytesTotal - BytesDone) / BytesPerSecond); } } }
    }

    /// <summary>
    /// Verifies files against their baselines. Used by the full scan (all roots, resumable) and by the background
    /// queue (single files: newly added items, user re-checks). No Emby types here so it is unit-testable.
    /// </summary>
    public sealed class ScanEngine
    {
        private readonly IntegrityStore _store;
        private readonly Func<DateTime> _now;
        public ScanOptions Options { get; set; } = new ScanOptions();
        public ScanEngine(IntegrityStore store, Func<DateTime> now = null) { _store = store; _now = now ?? (() => DateTime.UtcNow); }

        public sealed class Outcome { public string Result; public FileRecord File; public HashOutcome Hash; }

        // ---------------- single file ----------------
        /// <summary>Hash one file and update its record + history. Returns the check result.</summary>
        public Outcome CheckFile(string path, string source, long? scanId, IHashGate gate, CancellationToken ct, Action<long> onBytes = null, Action<string> onPause = null, long? logId = null)
        {
            var now = _now();
            var rec = _store.GetFile(path);
            FileInfo fi = null;
            try { fi = new FileInfo(path); if (!fi.Exists) fi = null; } catch { fi = null; }
            if (fi == null)
            {
                if (rec == null) return new Outcome { Result = "absent" };
                if (rec.Status != FileStatus.Missing)
                {
                    rec.Status = FileStatus.Missing; rec.LastResult = CheckResult.Missing; rec.LastChecked = now; rec.LastScanId = scanId ?? rec.LastScanId;
                    _store.Db.Transaction(() => { _store.UpdateFile(rec); _store.AddCheck(new CheckRecord { FileId = rec.Id, Time = now, Result = CheckResult.Missing, Source = source, ScanId = scanId ?? logId }); });
                }
                return new Outcome { Result = CheckResult.Missing, File = rec };
            }
            var h = Hasher.Hash(path, gate, ct, onBytes, onPause);
            now = _now();
            var mtime = DateTime.SpecifyKind(fi.LastWriteTimeUtc, DateTimeKind.Utc);
            bool isNew = rec == null;
            if (isNew) rec = new FileRecord { Path = path, FirstSeen = now, Status = FileStatus.Pending };
            bool firstHash = isNew || (rec.Status == FileStatus.Pending && string.IsNullOrEmpty(rec.BaselineMd5)); // incl. files found by the disk enumeration
            string result;
            if (!h.Ok)
            {
                result = CheckResult.Unreadable; rec.Status = FileStatus.Unreadable; rec.Error = h.Error;
            }
            else if (string.IsNullOrEmpty(rec.BaselineMd5))
            {
                result = CheckResult.Baseline; rec.BaselineMd5 = h.Md5; rec.BaselineSize = fi.Length; rec.BaselineMtime = mtime; rec.BaselineDate = now; rec.Status = FileStatus.Ok; rec.Error = null;
            }
            else if (h.Md5 == rec.BaselineMd5)
            {
                result = CheckResult.Match; rec.Status = FileStatus.Ok; rec.Error = null;
                if (rec.BaselineSize == null) rec.BaselineSize = fi.Length;
                if (rec.BaselineMtime == null) rec.BaselineMtime = mtime;
            }
            else
            {
                bool sizeChanged = rec.BaselineSize.HasValue && rec.BaselineSize.Value != fi.Length;
                bool timeChanged = rec.BaselineMtime.HasValue && Math.Abs((rec.BaselineMtime.Value - mtime).TotalSeconds) > Options.MtimeToleranceSeconds;
                if (sizeChanged || timeChanged)
                {
                    var ext = (Path.GetExtension(path) ?? "").ToLowerInvariant();
                    if (Options.AutoAcceptModifiedExtensions.Any(e => NormExt(e) == ext))
                    {
                        result = CheckResult.ModifiedAccepted; rec.BaselineMd5 = h.Md5; rec.BaselineSize = fi.Length; rec.BaselineMtime = mtime; rec.BaselineDate = now; rec.Status = FileStatus.Ok;
                    }
                    else { result = CheckResult.Modified; rec.Status = FileStatus.Modified; }
                }
                else { result = CheckResult.Changed; rec.Status = FileStatus.Changed; }
                rec.Error = null;
            }
            rec.Size = fi.Length; rec.Mtime = mtime; rec.LastMd5 = h.Md5 ?? rec.LastMd5; rec.LastChecked = now; rec.LastResult = result; rec.LastSeen = now;
            if (scanId.HasValue) rec.LastScanId = scanId;
            _store.Db.Transaction(() =>
            {
                if (isNew) _store.InsertFile(rec); else _store.UpdateFile(rec);
                _store.AddCheck(new CheckRecord { FileId = rec.Id, Time = now, Md5 = h.Md5, Size = fi.Length, Seconds = Math.Round(h.Seconds, 3), Result = result, Source = source, ScanId = scanId ?? logId, Note = h.Error });
            });
            return new Outcome { Result = firstHash && result == CheckResult.Baseline ? "new" : result, File = rec, Hash = h };
        }

        public static string NormExt(string e) { e = (e ?? "").Trim().ToLowerInvariant(); return e.Length == 0 || e[0] == '.' ? e : "." + e; }

        // ---------------- enumeration ----------------
        /// <summary>Recorded on a new full scan: scheduled | manual.</summary>
        public string ScanTrigger { get; set; } = "scheduled";

        public sealed class Found { public string Path; public long Size; }

        public static Regex GlobsToRegex(IEnumerable<string> globs)
        {
            var parts = (globs ?? Enumerable.Empty<string>()).Select(g => (g ?? "").Trim()).Where(g => g.Length > 0)
                .Select(g => "^" + Regex.Escape(g).Replace("\\*", ".*").Replace("\\?", ".") + "$").ToList();
            return parts.Count == 0 ? null : new Regex(string.Join("|", parts), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }

        /// <summary>All files under the root (every type), sorted ordinal-ignore-case so a resumed scan walks the same order.</summary>
        public static List<Found> Enumerate(string root, Regex exclude, CancellationToken ct, List<string> errors)
        {
            var list = new List<Found>();
            var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.System, ReturnSpecialDirectories = false };
            try
            {
                foreach (var f in new DirectoryInfo(root).EnumerateFiles("*", opts))
                {
                    ct.ThrowIfCancellationRequested();
                    if (exclude != null && exclude.IsMatch(f.Name)) continue;
                    long len; try { len = f.Length; } catch { len = 0; }
                    list.Add(new Found { Path = f.FullName, Size = len });
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { errors?.Add(root + ": " + ex.Message); }
            return list;
        }

        /// <summary>Removes roots nested inside other roots (a library folder inside an extra folder is scanned once).</summary>
        public static List<ScanRoot> DistinctRoots(IEnumerable<ScanRoot> roots)
        {
            var list = roots.Where(r => !string.IsNullOrWhiteSpace(r?.Path)).Select(r => new ScanRoot(r.Path.TrimEnd('\\', '/'), r.Label)).ToList();
            var outp = new List<ScanRoot>();
            foreach (var r in list.OrderBy(r => r.Path.Length))
            {
                var p = IntegrityStore.WithSep(r.Path);
                if (outp.Any(o => p.StartsWith(IntegrityStore.WithSep(o.Path), StringComparison.OrdinalIgnoreCase))) continue;
                outp.Add(r);
            }
            return outp.OrderBy(r => r.Path, StringComparer.OrdinalIgnoreCase).ToList();
        }

        // ---------------- full scan ----------------
        public sealed class FullScanResult { public ScanRecord Scan; public bool Completed; public List<string> UnavailableRoots = new List<string>(); }

        /// <summary>
        /// Full integrity scan. Resumes the last unfinished full scan (files it already checked carry its id and are skipped).
        /// On completion, records under an online root that the scan never saw are marked missing; a root that is offline
        /// is skipped entirely (its files are not marked missing).
        /// </summary>
        public FullScanResult RunFull(IList<ScanRoot> roots, IHashGate gate, ScanProgress progress, CancellationToken ct, bool resume = true, Action<double> taskProgress = null)
        {
            var now = _now();
            var res = new FullScanResult();
            var rootList = DistinctRoots(roots);
            var rootsText = string.Join("\n", rootList.Select(r => r.Path));
            ScanRecord scan = resume ? _store.ResumableScan("full") : null;
            if (!resume) { var old = _store.ResumableScan("full"); if (old != null) { old.State = "abandoned"; old.Ended = now; _store.SaveScan(old); } }
            if (scan == null) scan = _store.NewScan("full", now, rootsText, "Full integrity scan", ScanTrigger);
            else { scan.State = "running"; scan.Roots = rootsText; scan.Note = "resumed " + Time.ToDb(now) + (string.IsNullOrEmpty(scan.Note) ? "" : "; " + scan.Note); _store.SaveScan(scan); }
            res.Scan = scan;
            progress.Begin(scan, now);
            try
            {
                var exclude = GlobsToRegex(Options.Exclude);
                var errors = new List<string>();
                var all = new List<Found>(); var online = new List<ScanRoot>();
                foreach (var r in rootList)
                {
                    ct.ThrowIfCancellationRequested();
                    bool ok; try { ok = Directory.Exists(r.Path); } catch { ok = false; }
                    if (!ok) { res.UnavailableRoots.Add(r.Path); continue; }
                    online.Add(r);
                    all.AddRange(Enumerate(r.Path, exclude, ct, errors));
                }
                all = all.GroupBy(f => f.Path, StringComparer.OrdinalIgnoreCase).Select(g => g.First()).OrderBy(f => f.Path, StringComparer.OrdinalIgnoreCase).ToList();
                // files of this scan that were already handled before a stop/restart
                var doneIds = new HashSet<string>(_store.Db.Query("SELECT path FROM files WHERE last_scan_id=@s", ("s", scan.Id)).Select(r => r.Str("path")), StringComparer.OrdinalIgnoreCase);
                scan.Total = all.Count; scan.BytesTotal = all.Sum(f => f.Size);
                scan.Done = all.Count(f => doneIds.Contains(f.Path));
                scan.BytesDone = all.Where(f => doneIds.Contains(f.Path)).Sum(f => f.Size);
                if (res.UnavailableRoots.Count > 0 || errors.Count > 0) scan.Note = Trim(string.Join("; ", res.UnavailableRoots.Select(u => "offline: " + u).Concat(errors).Concat(string.IsNullOrEmpty(scan.Note) ? new string[0] : new[] { scan.Note })), 900);
                _store.SaveScan(scan);
                progress.Begin(scan, _now());
                progress.SetState("hashing");
                taskProgress?.Invoke(progress.Percent);

                long idx = scan.Done; var lastSave = _now();
                foreach (var f in all)
                {
                    ct.ThrowIfCancellationRequested();
                    if (doneIds.Contains(f.Path)) continue;
                    idx++;
                    progress.StartFile(idx, f.Path, f.Size);
                    var started = _now(); long before = progress.BytesDone;
                    var o = CheckFile(f.Path, "scan", scan.Id, gate, ct,
                        n => { progress.Bytes(n, _now()); },
                        why => { if (why != null) progress.SetState("paused", why); else { progress.SetState("hashing"); progress.ResetRateClock(_now()); } });
                    // keep the byte total honest when the size changed since enumeration
                    var hashed = o.Hash?.Bytes ?? 0;
                    if (hashed != f.Size) { scan.BytesTotal += hashed - f.Size; }
                    switch (o.Result)
                    {
                        case "new": case CheckResult.Baseline: scan.New++; break;
                        case CheckResult.Match: scan.Matched++; break;
                        case CheckResult.Changed: scan.Changed++; break;
                        case CheckResult.Modified: scan.Modified++; break;
                        case CheckResult.ModifiedAccepted: scan.Matched++; break;
                        case CheckResult.Missing: scan.Missing++; break;
                        case CheckResult.Unreadable: scan.Unreadable++; break;
                    }
                    scan.Done = idx; scan.BytesDone += hashed; scan.Position = f.Path;
                    scan.ActiveSeconds += o.Hash?.Seconds ?? 0; scan.BytesHashed += hashed;
                    progress.Copy(scan);
                    var t = _now();
                    if ((t - lastSave).TotalSeconds >= 5 || o.Result != CheckResult.Match) { _store.SaveScan(scan); lastSave = t; }
                    taskProgress?.Invoke(progress.Percent);
                }
                // missing: records under online roots that this scan never visited
                progress.SetState("finishing");
                foreach (var r in online)
                {
                    foreach (var rec in _store.NotVisitedUnder(r.Path, scan.Id))
                    {
                        ct.ThrowIfCancellationRequested();
                        if (exclude != null && exclude.IsMatch(rec.Name ?? "")) continue;
                        bool exists; try { exists = File.Exists(rec.Path); } catch { exists = true; }
                        if (exists) continue; // appeared after enumeration; next scan will check it
                        var o = CheckFile(rec.Path, "scan", scan.Id, gate, ct);
                        if (o.Result == CheckResult.Missing) scan.Missing++;
                    }
                }
                scan.State = "completed"; scan.Ended = _now(); res.Completed = true;
                _store.SaveScan(scan);
                taskProgress?.Invoke(100);
            }
            catch (OperationCanceledException)
            {
                scan.State = "stopped"; scan.Ended = null; _store.SaveScan(scan);
                throw;
            }
            catch (Exception ex)
            {
                scan.State = "failed"; scan.Ended = _now(); scan.Note = Trim("error: " + ex.Message + (string.IsNullOrEmpty(scan.Note) ? "" : "; " + scan.Note), 900); _store.SaveScan(scan);
                throw;
            }
            finally { progress.Copy(scan); progress.End(); }
            return res;
        }

        private static string Trim(string s, int n) => s == null || s.Length <= n ? s : s.Substring(0, n) + "…";
    }
}
