using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;

namespace Claw.Emby.MediaIntegrity.Core
{
    /// <summary>One user-requested check ("Verify integrity" on an item, "Check now" / "Check selected" / "Check this folder").</summary>
    public sealed class CheckJob
    {
        public long Id { get; set; }
        public string Label { get; set; }
        public string Source { get; set; }
        public string State { get; set; } = "queued"; // queued | running | done | cancelled
        public DateTime Created { get; set; }
        public DateTime? Started { get; set; }
        public DateTime? Ended { get; set; }
        public int Total { get; set; }
        public int Done { get; set; }
        public long BytesTotal { get; set; }
        public long BytesDone { get; set; }
        public string CurrentFile { get; set; }
        public long CurrentSize { get; set; }
        public long CurrentDone { get; set; }
        public int Ok { get; set; }
        public int New { get; set; }
        public int Changed { get; set; }
        public int Modified { get; set; }
        public int Missing { get; set; }
        public int Unreadable { get; set; }
        /// <summary>Files that are not on disk and were never tracked (nothing to report).</summary>
        public int Absent { get; set; }
        /// <summary>Problem files of this job (up to 50), for the toast / dialog.</summary>
        public List<JobFinding> Findings { get; set; } = new List<JobFinding>();
        /// <summary>Every checked file of the job (up to 500) with its result, so the page can update rows in place.</summary>
        public List<JobFinding> Results { get; set; } = new List<JobFinding>();
        public double BytesPerSecond { get; set; }
        [JsonIgnore] public List<string> Paths { get; set; } = new List<string>();
        public int Problems => Changed + Modified + Missing + Unreadable;
        /// <summary>How many requests were merged into this job (a later "Check selected" appends to the active job).</summary>
        public int Batches { get; set; } = 1;
        /// <summary>Activity entry (scans table) of this job; its checks carry this id.</summary>
        public long? LogId { get; set; }
        /// <summary>Files added by the last merged batch (0 when it brought nothing new).</summary>
        public int LastBatchAdded { get; set; }
        /// <summary>Index into Results where this response starts (GET .../Jobs/{id}?Since=n returns only newer results).</summary>
        public int ResultsOffset { get; set; }
        [JsonIgnore] public HashSet<string> Pending { get; set; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        [JsonIgnore] public string FirstLabel { get; set; }

        public CheckJob CopyFrom(int since)
        {
            var c = (CheckJob)MemberwiseClone();
            since = Math.Max(0, Math.Min(since, Results.Count));
            c.ResultsOffset = since; c.Results = Results.Skip(since).ToList(); c.Findings = Findings.ToList();
            return c;
        }
    }

    public sealed class JobFinding { public long FileId { get; set; } public string Path { get; set; } public string Result { get; set; } }

    /// <summary>
    /// Background queue for manual checks. Separate from the full scan: it has its own thread and gate, so it keeps
    /// running while the full scan is paused (or not running). Jobs run one after another, one file at a time.
    /// </summary>
    public sealed class ManualCheckQueue : IDisposable
    {
        private readonly ScanEngine _engine;
        private readonly IHashGate _gate;
        private readonly Func<DateTime> _now;
        private readonly object _l = new object();
        private readonly List<CheckJob> _jobs = new List<CheckJob>();
        private readonly AutoResetEvent _wake = new AutoResetEvent(false);
        private CancellationTokenSource _cancel = new CancellationTokenSource();
        private Thread _thread;
        private volatile bool _disposed;
        private long _nextId;
        private double _rate; private DateTime _rateT; private long _rateB;
        public Action<CheckJob> JobFinished { get; set; }
        /// <summary>Called on the worker thread before the job's first file (the host opens its Activity entry and sets LogId).</summary>
        public Action<CheckJob> JobStarted { get; set; }
        public Action<string, Exception> OnError { get; set; }
        public const int KeepFinished = 30;

        public ManualCheckQueue(ScanEngine engine, IHashGate gate, Func<DateTime> now = null)
        {
            _engine = engine; _gate = gate; _now = now ?? (() => DateTime.UtcNow);
        }

        public void Start()
        {
            if (_thread != null) return;
            _thread = new Thread(Loop) { IsBackground = true, Name = "MediaIntegrity manual checks", Priority = ThreadPriority.BelowNormal };
            _thread.Start();
        }

        /// <summary>
        /// Queues files for checking. If a manual job is already queued or running, the files are appended to it
        /// (its total grows; files already pending in it are not added twice) and that job is returned, so the
        /// progress panel shows one combined "x of y". Otherwise a new job starts.
        /// </summary>
        public CheckJob Enqueue(string label, IEnumerable<string> paths, string source = "manual", bool append = true)
        {
            var list = Distinct(paths);
            var sizes = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in list) { try { var fi = new FileInfo(p); sizes[p] = fi.Exists ? fi.Length : 0; } catch { sizes[p] = 0; } }
            CheckJob job;
            lock (_l)
            {
                job = append ? _jobs.Where(x => x.State == "running" || x.State == "queued").OrderBy(x => x.Id).FirstOrDefault() : null;
                if (job != null && list.Count > 0)
                {
                    int added = 0;
                    foreach (var p in list)
                    {
                        if (!job.Pending.Add(p)) continue;
                        job.Paths.Add(p); job.BytesTotal += sizes[p]; added++;
                    }
                    job.Total += added; job.Batches++; job.LastBatchAdded = added;
                    job.Label = job.FirstLabel + " + " + (job.Batches - 1) + " more batch" + (job.Batches == 2 ? "" : "es");
                }
                else
                {
                    job = new CheckJob { Id = Interlocked.Increment(ref _nextId), Label = label, FirstLabel = label, Source = source, Created = _now(), Paths = list, Total = list.Count, LastBatchAdded = list.Count };
                    foreach (var p in list) { job.Pending.Add(p); job.BytesTotal += sizes[p]; }
                    _jobs.Add(job);
                    if (list.Count == 0) { job.State = "done"; job.Started = job.Ended = job.Created; }
                    Trim();
                }
            }
            if (job.Total == 0 && job.State == "done") JobFinished?.Invoke(job); else { _wake.Set(); try { Queued?.Invoke(); } catch { } }
            return job;
        }

        public static List<string> Distinct(IEnumerable<string> paths)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var outp = new List<string>();
            foreach (var p in paths ?? Enumerable.Empty<string>()) if (!string.IsNullOrWhiteSpace(p) && seen.Add(p.Trim())) outp.Add(p.Trim());
            return outp;
        }

        /// <summary>Snapshot of a job (safe to serialize while the worker updates it). since: only results after this index.</summary>
        public CheckJob Get(long id, int since = 0) { lock (_l) return _jobs.FirstOrDefault(j => j.Id == id)?.CopyFrom(since); }
        public List<CheckJob> Jobs() { lock (_l) return _jobs.OrderByDescending(j => j.Id).Select(j => j.CopyFrom(j.Results.Count)).ToList(); }
        public CheckJob Current { get { lock (_l) return _jobs.FirstOrDefault(j => j.State == "running")?.CopyFrom(int.MaxValue); } }
        public int QueuedJobs { get { lock (_l) return _jobs.Count(j => j.State == "queued"); } }
        public int PendingFiles { get { lock (_l) return _jobs.Where(j => j.State == "queued" || j.State == "running").Sum(j => j.Total - j.Done); } }
        public double BytesPerSecond => _rate;
        public bool Busy { get { lock (_l) return _jobs.Any(j => j.State == "queued" || j.State == "running"); } }
        /// <summary>Called after work was queued (the host starts the "Manual integrity check" task).</summary>
        public Action Queued { get; set; }

        /// <summary>Overall progress 0..100 of the running and queued jobs (files, with the current file's bytes as a fraction).</summary>
        public double Percent
        {
            get
            {
                lock (_l)
                {
                    var act = _jobs.Where(j => j.State == "queued" || j.State == "running").ToList();
                    long total = act.Sum(j => (long)j.Total); if (total == 0) return 100;
                    double done = act.Sum(j => (double)j.Done) + act.Where(j => j.State == "running" && j.CurrentSize > 0).Sum(j => Math.Min(1.0, (double)j.CurrentDone / j.CurrentSize));
                    return Math.Max(0, Math.Min(100, 100.0 * done / total));
                }
            }
        }

        /// <summary>Body of the Emby task "Manual integrity check": reports progress while the queue has work, cancels the
        /// queue when Emby cancels the task, and returns when the queue is empty. The worker thread does the hashing.</summary>
        public static void RunWhileBusy(ManualCheckQueue q, CancellationToken ct, IProgress<double> progress, int pollMs = 1000, int graceMs = 3000)
        {
            var idleSince = DateTime.UtcNow; double last = -1;
            while (true)
            {
                if (ct.IsCancellationRequested) { q.CancelAll(); progress?.Report(100); return; }
                if (q.Busy)
                {
                    idleSince = DateTime.UtcNow;
                    // the dashboard bar never jumps back when a batch is appended (the page shows the exact x of y)
                    var p = Math.Max(last, Math.Round(q.Percent, 1));
                    if (p != last) { progress?.Report(p); last = p; }
                }
                else if ((DateTime.UtcNow - idleSince).TotalMilliseconds >= graceMs) { progress?.Report(100); return; } // short grace: a follow-up batch keeps the same task run
                ct.WaitHandle.WaitOne(pollMs);
            }
        }

        /// <summary>Cancels the running job and all queued ones.</summary>
        public int CancelAll()
        {
            int n;
            lock (_l)
            {
                n = 0;
                foreach (var j in _jobs.Where(j => j.State == "queued")) { j.State = "cancelled"; j.Ended = _now(); n++; }
                if (_jobs.Any(j => j.State == "running")) n++;
                var old = _cancel; _cancel = new CancellationTokenSource(); old.Cancel();
            }
            return n;
        }

        private void Trim()
        {
            var fin = _jobs.Where(j => j.State == "done" || j.State == "cancelled").OrderByDescending(j => j.Id).Skip(KeepFinished).ToList();
            foreach (var j in fin) _jobs.Remove(j);
        }

        /// <summary>Runs queued jobs on the calling thread until none is left (the worker thread uses this; tests call it directly).</summary>
        public void Drain()
        {
            while (!_disposed)
            {
                CheckJob job; CancellationToken ct;
                lock (_l)
                {
                    job = _jobs.Where(j => j.State == "queued").OrderBy(j => j.Id).FirstOrDefault();
                    if (job == null) return;
                    job.State = "running"; job.Started = _now(); ct = _cancel.Token;
                }
                try { JobStarted?.Invoke(job); } catch { }
                RunJob(job, ct);
                JobFinished?.Invoke(job);
            }
        }

        private void RunJob(CheckJob job, CancellationToken ct)
        {
            _rateT = _now(); _rateB = 0;
            try
            {
                for (int idx = 0; ; idx++)
                {
                    string path;
                    lock (_l)
                    {
                        // finish under the lock so a batch appended at this moment is never lost
                        if (idx >= job.Paths.Count) { job.State = "done"; break; }
                        path = job.Paths[idx];
                    }
                    ct.ThrowIfCancellationRequested();
                    long size = 0; try { var fi = new FileInfo(path); if (fi.Exists) size = fi.Length; } catch { }
                    lock (_l) { job.CurrentFile = path; job.CurrentSize = size; job.CurrentDone = 0; }
                    ScanEngine.Outcome o = null;
                    try { o = _engine.CheckFile(path, job.Source == "item" ? "manual" : job.Source, null, _gate, ct, n => Bytes(job, n), null, job.LogId); }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception ex) { OnError?.Invoke(path, ex); }
                    lock (_l)
                    {
                        job.Pending.Remove(path);
                        job.Done++;
                        switch (o?.Result)
                        {
                            case CheckResult.Match: case CheckResult.ModifiedAccepted: case CheckResult.Baseline: job.Ok++; break;
                            case "new": job.New++; break;
                            case CheckResult.Changed: job.Changed++; break;
                            case CheckResult.Modified: job.Modified++; break;
                            case CheckResult.Missing: job.Missing++; break;
                            case CheckResult.Unreadable: job.Unreadable++; break;
                            case "absent": job.Absent++; break;
                            default: job.Unreadable++; break;
                        }
                        if (o?.File != null && (o.Result == CheckResult.Changed || o.Result == CheckResult.Modified || o.Result == CheckResult.Missing || o.Result == CheckResult.Unreadable) && job.Findings.Count < 50)
                            job.Findings.Add(new JobFinding { FileId = o.File.Id, Path = path, Result = o.Result });
                        if (job.Results.Count < 100000) job.Results.Add(new JobFinding { FileId = o?.File?.Id ?? 0, Path = path, Result = o?.Result ?? "error" });
                    }
                }
            }
            catch (OperationCanceledException) { lock (_l) job.State = "cancelled"; }
            finally { lock (_l) { job.Ended = _now(); job.CurrentFile = null; job.CurrentSize = job.CurrentDone = 0; Trim(); } }
        }

        private void Bytes(CheckJob job, long n)
        {
            var now = _now();
            lock (_l)
            {
                job.BytesDone += n; job.CurrentDone += n; _rateB += n;
                var dt = (now - _rateT).TotalSeconds;
                if (dt >= 0.5) { var r = _rateB / dt; _rate = _rate <= 0 ? r : _rate * 0.7 + r * 0.3; _rateT = now; _rateB = 0; job.BytesPerSecond = _rate; }
            }
        }

        private void Loop()
        {
            while (!_disposed)
            {
                _wake.WaitOne(10000);
                if (_disposed) break;
                try { Drain(); } catch (Exception ex) { if (!_disposed) OnError?.Invoke(null, ex); }
            }
        }

        public void Dispose()
        {
            _disposed = true;
            try { _cancel.Cancel(); } catch { }
            _wake.Set();
            try { _thread?.Join(3000); } catch { }
        }

        // ---------------- target expansion (pure, unit-tested) ----------------
        /// <summary>
        /// Files to check for a set of targets: each file path itself plus its "companions" (same base name in the same folder,
        /// e.g. Movie.nfo, Movie.en.srt, Movie-poster.jpg); each directory recursively; plus files already tracked under those
        /// directories that are gone from disk (so a manual check reports them missing).
        /// </summary>
        /// <summary>Files to baseline for a new library item of any type (movie, episode, track, audiobook...):
        /// a file item itself; a folder item (album, audiobook folder, series...) its files directly in that folder.</summary>
        public static List<string> NewItemFiles(string path, bool isFolder, Regex exclude)
        {
            var list = new List<string>();
            try
            {
                if (!isFolder) { if (!Directory.Exists(path)) list.Add(path); return list; }
                if (!Directory.Exists(path)) return list;
                foreach (var f in Directory.EnumerateFiles(path).Take(2000)) if (exclude == null || !exclude.IsMatch(Path.GetFileName(f))) list.Add(f);
            }
            catch { }
            return list;
        }

        public static List<string> ExpandTargets(IEnumerable<string> files, IEnumerable<string> dirs, Regex exclude, Func<IList<string>, List<string>> knownUnder, bool companions = true)
        {
            var outp = new List<string>();
            foreach (var f in files ?? Enumerable.Empty<string>())
            {
                if (string.IsNullOrWhiteSpace(f)) continue;
                outp.Add(f);
                if (companions) outp.AddRange(Companions(f, exclude));
            }
            var dl = (dirs ?? Enumerable.Empty<string>()).Where(d => !string.IsNullOrWhiteSpace(d)).Select(d => d.TrimEnd('\\', '/')).ToList();
            dl = ScanEngine.DistinctRoots(dl.Select(d => new ScanRoot(d, ""))).Select(r => r.Path).ToList();
            foreach (var d in dl) outp.AddRange(ScanEngine.Enumerate(d, exclude, CancellationToken.None, null).Select(x => x.Path));
            if (knownUnder != null && dl.Count > 0) outp.AddRange(knownUnder(dl));
            var res = Distinct(outp);
            res.Sort(StringComparer.OrdinalIgnoreCase);
            return res;
        }

        public static IEnumerable<string> Companions(string file, Regex exclude)
        {
            string dir, stem;
            try { dir = Path.GetDirectoryName(file); stem = Path.GetFileNameWithoutExtension(file); } catch { yield break; }
            if (string.IsNullOrEmpty(dir) || string.IsNullOrEmpty(stem) || !Directory.Exists(dir)) yield break;
            string[] all;
            try { all = Directory.GetFiles(dir); } catch { yield break; }
            foreach (var p in all)
            {
                var n = Path.GetFileName(p);
                if (string.Equals(p, file, StringComparison.OrdinalIgnoreCase)) continue;
                if (exclude != null && exclude.IsMatch(n)) continue;
                if (!n.StartsWith(stem, StringComparison.OrdinalIgnoreCase)) continue;
                var rest = n.Substring(stem.Length);
                if (rest.Length == 0 || rest[0] == '.' || rest[0] == '-' || rest[0] == '_') yield return p;
            }
        }
    }
}
