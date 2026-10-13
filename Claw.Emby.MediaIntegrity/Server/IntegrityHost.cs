using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Claw.Emby.MediaIntegrity.Core;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Notifications;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Tasks;

namespace Claw.Emby.MediaIntegrity.Server
{
    /// <summary>
    /// Owns the database, the scan engine, the background hash queue (new library items + re-checks), pause/throttle
    /// state and notifications. The scheduled task and the API both go through here.
    /// </summary>
    public class IntegrityHost : IServerEntryPoint
    {
        public static IntegrityHost Instance { get; private set; }

        private readonly IServerConfigurationManager _config;
        private readonly ILibraryManager _library;
        private readonly ISessionManager _sessions;
        private readonly INotificationManager _notifications;
        private readonly ITaskManager _tasks;
        private readonly ILogger _log;
        private Timer _queueTimer;
        private Thread _queueThread;
        private readonly AutoResetEvent _queueWake = new AutoResetEvent(false);
        private volatile bool _disposed;
        private CancellationTokenSource _scanStop;
        private int _scanRunning;
        private volatile bool _forceNextRun;

        public IntegrityStore Store { get; private set; }
        public ScanEngine Engine { get; private set; }
        public ScanProgress Progress { get; } = new ScanProgress();
        public Gate ScanGate { get; }
        public Gate QueueGate { get; }
        public ManualGateImpl ManualGate { get; }
        public ManualCheckQueue Manual { get; private set; }
        public string DataDir { get; private set; }
        public ImportResult Import { get; private set; }
        public string QueueCurrent { get; private set; }
        public string LastSkipReason { get; private set; }
        public bool ScanRunning => _scanRunning != 0;

        // ---------------- disk enumeration cache ----------------
        private Timer _discoverTimer;
        private int _discovering;
        private string _discoverReason = "startup";
        public bool Discovering => _discovering != 0;
        public DiscoveryResult LastDiscovery { get; private set; }
        public DateTime? DiscoveryRequested { get; private set; }

        /// <summary>Schedules a refresh of the file list (debounced: library changes arrive in bursts).</summary>
        public void RequestDiscovery(string reason, int delayMs)
        {
            _discoverReason = reason; DiscoveryRequested = DateTime.UtcNow.AddMilliseconds(delayMs);
            _discoverTimer?.Change(delayMs, Timeout.Infinite);
        }

        private void RunDiscovery()
        {
            if (_disposed || Interlocked.Exchange(ref _discovering, 1) == 1) return;
            try
            {
                DiscoveryRequested = null;
                var r = FileDiscovery.Run(Store, Roots(), ExcludeRegex(), _discoverReason, CancellationToken.None);
                LastDiscovery = r;
                try { Store.SetMeta("discovery", System.Text.Json.JsonSerializer.Serialize(r)); } catch { }
                _log.Info("Media Integrity: file list refreshed ({0}): {1} files on disk in {2} folders ({3} offline), {4} not yet hashed added, {5} gone removed, {6:0.0}s",
                    r.Reason, r.OnDisk, r.Roots, r.RootsOffline, r.Added, r.Removed, r.Seconds);
                foreach (var e in r.Errors.Take(5)) _log.Warn("Media Integrity: file list: {0}", e);
            }
            catch (Exception ex) { _log.ErrorException("Media Integrity: file list refresh", ex); }
            finally { Interlocked.Exchange(ref _discovering, 0); }
        }
        private void OnLibraryChanged(object sender, ItemChangeEventArgs e) { if (!_disposed) RequestDiscovery("library change", 60000); }

        public IntegrityHost(IServerConfigurationManager config, ILibraryManager library, ISessionManager sessions, INotificationManager notifications, ITaskManager tasks, ILogManager logManager)
        {
            _config = config; _library = library; _sessions = sessions; _notifications = notifications; _tasks = tasks;
            _log = logManager.GetLogger("MediaIntegrity");
            ScanGate = new Gate(this, true); QueueGate = new Gate(this, false); ManualGate = new ManualGateImpl(this);
        }

        public static PluginConfiguration Cfg => Plugin.Instance?.Configuration ?? new PluginConfiguration();

        // ---------------- pause / throttle ----------------
        public sealed class Gate : IHashGate
        {
            private readonly IntegrityHost _h; private readonly bool _scan;
            public volatile bool UserPaused;
            public Gate(IntegrityHost h, bool scan) { _h = h; _scan = scan; }
            public long BytesPerSecond => Math.Max(0, Cfg.ThrottleMBps) * 1024L * 1024L;
            public string PauseReason
            {
                get
                {
                    if (_h._disposed) return null;
                    if (_scan && UserPaused) return "paused";
                    if (Cfg.PauseDuringPlayback && _h.IsPlaybackActive()) return "playback";
                    return null;
                }
            }
        }

        /// <summary>Manual checks were asked for explicitly: they ignore the scan's pause and playback, only the speed limit applies.</summary>
        public sealed class ManualGateImpl : IHashGate
        {
            private readonly IntegrityHost _h;
            public ManualGateImpl(IntegrityHost h) { _h = h; }
            public long BytesPerSecond => Math.Max(0, Cfg.ThrottleMBps) * 1024L * 1024L;
            public string PauseReason => null;
        }

        private DateTime _playChecked; private bool _playing;
        public bool IsPlaybackActive()
        {
            var now = DateTime.UtcNow;
            if ((now - _playChecked).TotalSeconds < 3) return _playing;
            _playChecked = now;
            try { _playing = _sessions.Sessions.Any(s => s.NowPlayingItem != null); } catch { _playing = false; }
            return _playing;
        }

        // ---------------- lifecycle ----------------
        public void Run()
        {
            Instance = this;
            DataDir = Path.Combine(_config.ApplicationPaths.DataPath, "claw-mediaintegrity");
            Store = new IntegrityStore(Path.Combine(DataDir, "integrity.db"));
            Engine = new ScanEngine(Store);
            ApplyConfiguration();
            var n = Store.MarkInterrupted();
            if (n > 0) _log.Info("Media Integrity: {0} unfinished scan(s) marked interrupted; the next run resumes", n);

            var imp = Store.GetMeta(LegacyImporter.MetaKey);
            if (imp == null) ThreadPool.QueueUserWorkItem(_ => RunImport());
            else try { Import = System.Text.Json.JsonSerializer.Deserialize<ImportResult>(imp); } catch { }

            _library.ItemAdded += OnItemAdded;
            _library.ItemRemoved += OnLibraryChanged;
            try { LastDiscovery = System.Text.Json.JsonSerializer.Deserialize<DiscoveryResult>(Store.GetMeta("discovery") ?? "null"); } catch { }
            _discoverTimer = new Timer(_ => RunDiscovery(), null, Timeout.Infinite, Timeout.Infinite);
            RequestDiscovery("startup", 90000);
            _queueThread = new Thread(QueueLoop) { IsBackground = true, Name = "MediaIntegrity queue", Priority = ThreadPriority.Lowest };
            _queueThread.Start();
            _queueTimer = new Timer(_ => _queueWake.Set(), null, 15000, 30000);
            Manual = new ManualCheckQueue(Engine, ManualGate)
            {
                OnError = (path, ex) => _log.ErrorException("Media Integrity: manual check " + (path ?? ""), ex),
                Queued = () => { try { _tasks.QueueIfNotRunning<ManualCheckTask>(); } catch (Exception ex) { _log.ErrorException("Media Integrity: start manual task", ex); } },
                JobStarted = j => { try { j.LogId = Store.NewScan(j.Source == "item" ? "item" : "manual", j.Started ?? DateTime.UtcNow, null, j.Label, j.Source).Id; } catch (Exception ex) { _log.ErrorException("Media Integrity: activity entry", ex); } },
                JobFinished = j => { LogJob(j); _log.Info("Media Integrity: manual check \"{0}\" {1}: {2} files, {3} ok, {4} new, {5} changed, {6} modified, {7} missing, {8} unreadable",
                    j.Label, j.State, j.Done, j.Ok, j.New, j.Changed, j.Modified, j.Missing, j.Unreadable); }
            };
            Manual.Start();
            _log.Info("Media Integrity started: {0} files, {1} checks, {2} queued", Store.FileCount, Store.CheckCount, Store.QueueLength);
        }

        public void ApplyConfiguration()
        {
            var c = Cfg;
            if (_discoverTimer != null) RequestDiscovery("settings changed", 5000);
            if (Engine != null) Engine.Options = new ScanOptions { Exclude = c.Exclude ?? new string[0], AutoAcceptModifiedExtensions = c.AutoAcceptModifiedExtensions ?? new string[0] };
        }

        public ImportResult RunImport()
        {
            var path = Cfg.LegacyDbPath;
            ImportResult r;
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) r = new ImportResult { Ran = false, Source = path, Time = DateTime.UtcNow, Error = string.IsNullOrWhiteSpace(path) ? "no legacy database configured" : "not found: " + path };
            else
            {
                _log.Info("Media Integrity: importing {0} (read-only copy)", path);
                r = LegacyImporter.Import(Store, path, Path.Combine(DataDir, "tmp"), DateTime.UtcNow);
                _log.Info("Media Integrity import: {0} files ({1} ok, {2} changed, {3} never hashed), {4} checks, {5} case duplicates merged, {6:0.0}s{7}",
                    r.FilesImported, r.Ok, r.Changed, r.NeverHashed, r.ChecksImported, r.CaseDuplicatesMerged, r.Seconds, r.Error == null ? "" : " ERROR " + r.Error);
            }
            Import = r;
            // only remember "done" when it ran (a missing file can be fixed in Settings → Import now)
            if (r.Ran && r.Error == null) Store.SetMeta(LegacyImporter.MetaKey, System.Text.Json.JsonSerializer.Serialize(r));
            return r;
        }

        public void Dispose()
        {
            _disposed = true;
            _library.ItemAdded -= OnItemAdded;
            _library.ItemRemoved -= OnLibraryChanged;
            _discoverTimer?.Dispose();
            _queueTimer?.Dispose();
            try { Manual?.Dispose(); } catch { }
            try { _scanStop?.Cancel(); } catch { }
            _queueWake.Set();
            try { _queueThread?.Join(3000); } catch { }
            try { Store?.Dispose(); } catch { }
            if (Instance == this) Instance = null;
        }

        // ---------------- scope ----------------
        public sealed class LibraryInfo { public string Id { get; set; } public string Name { get; set; } public string Type { get; set; } public string[] Locations { get; set; } public bool Included { get; set; } }

        public List<LibraryInfo> Libraries()
        {
            var excluded = new HashSet<string>(Cfg.ExcludedLibraryIds ?? new string[0], StringComparer.OrdinalIgnoreCase);
            var appData = _config.ApplicationPaths.ProgramDataPath;
            return _library.GetVirtualFolders().Select(v => new LibraryInfo
            {
                Id = v.ItemId ?? v.Id, Name = v.Name, Type = v.CollectionType,
                // boxsets / playlists live in Emby's own data folder; they hold no media
                Locations = (v.Locations ?? new string[0]).Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith(appData, StringComparison.OrdinalIgnoreCase)).ToArray(),
                Included = !excluded.Contains(v.ItemId ?? v.Id ?? "")
            }).Where(l => l.Locations.Length > 0).ToList();
        }

        public List<ScanRoot> Roots()
        {
            var roots = new List<ScanRoot>();
            foreach (var l in Libraries().Where(l => l.Included)) roots.AddRange(l.Locations.Select(p => new ScanRoot(p, l.Name)));
            roots.AddRange((Cfg.ExtraFolders ?? new string[0]).Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => new ScanRoot(p.Trim(), "Extra folder")));
            return ScanEngine.DistinctRoots(roots);
        }

        // ---------------- full scan ----------------
        public void RequestStart(bool fresh)
        {
            _forceNextRun = true;
            if (fresh) { var s = Store.ResumableScan("full"); if (s != null) { s.State = "abandoned"; s.Ended = DateTime.UtcNow; Store.SaveScan(s); } }
            ScanGate.UserPaused = false;
            _tasks.QueueIfNotRunning<FullScanTask>();
        }
        public void Pause() { ScanGate.UserPaused = true; }
        public void Resume() { ScanGate.UserPaused = false; }
        public void Stop() { ScanGate.UserPaused = false; try { _scanStop?.Cancel(); } catch { } }

        /// <summary>Newest complete verification: a completed plugin scan, else the newest imported check.</summary>
        public DateTime? LastCompleteVerification()
        {
            var s = Store.Scans(50).FirstOrDefault(x => x.Kind == "full" && x.State == "completed");
            if (s?.Ended != null) return s.Ended;
            return Import?.NewestCheck;
        }

        public async Task RunFullScanAsync(CancellationToken emby, IProgress<double> progress)
        {
            if (Interlocked.Exchange(ref _scanRunning, 1) == 1) return;
            try
            {
                bool forced = _forceNextRun; _forceNextRun = false;
                Engine.ScanTrigger = forced ? "manual" : "scheduled";
                var minDays = Cfg.MinDaysBetweenScheduledScans;
                var last = LastCompleteVerification();
                bool resumable = Store.ResumableScan("full") != null;
                if (!forced && !resumable && minDays > 0 && last.HasValue && (DateTime.UtcNow - last.Value).TotalDays < minDays)
                {
                    LastSkipReason = string.Format("Skipped {0:yyyy-MM-dd}: last complete verification {1:yyyy-MM-dd} is newer than {2} days. Use Start scan on the Media Integrity page to run anyway.", DateTime.Now, last.Value.ToLocalTime(), minDays);
                    _log.Info("Media Integrity: " + LastSkipReason);
                    progress?.Report(100);
                    return;
                }
                LastSkipReason = null;
                _scanStop = CancellationTokenSource.CreateLinkedTokenSource(emby);
                var ct = _scanStop.Token;
                var roots = Roots();
                ScanEngine.FullScanResult res = null;
                Exception error = null;
                // dedicated low-priority thread (the hashing loop is synchronous)
                var t = new Thread(() =>
                {
                    try { res = Engine.RunFull(roots, ScanGate, Progress, ct, true, p => progress?.Report(p)); }
                    catch (Exception ex) { error = ex; }
                }) { IsBackground = true, Name = "MediaIntegrity scan", Priority = ThreadPriority.Lowest };
                t.Start();
                while (t.IsAlive) await Task.Delay(500).ConfigureAwait(false);
                if (error is OperationCanceledException)
                {
                    _log.Info("Media Integrity: scan stopped at {0} of {1}; it resumes on the next run", Progress.FileIndex, Progress.FileCount);
                    if (emby.IsCancellationRequested) throw error;
                    return;
                }
                if (error != null) { _log.ErrorException("Media Integrity: scan failed", error); throw error; }
                if (res?.Completed == true) Notify(res.Scan);
            }
            finally
            {
                ScanGate.UserPaused = false;
                _scanStop?.Dispose(); _scanStop = null;
                Interlocked.Exchange(ref _scanRunning, 0);
            }
        }

        private void Notify(ScanRecord s)
        {
            var c = Cfg;
            var problems = s.Changed + s.Modified + s.Missing + s.Unreadable;
            try
            {
                if (c.NotifyScanSummary)
                    _notifications.SendNotification(new global::Emby.Notifications.NotificationRequest
                    {
                        EventId = IntegrityNotifications.SummaryEventId,
                        Title = "Integrity scan finished: " + (problems == 0 ? "no problems" : problems + " problem" + (problems == 1 ? "" : "s")),
                        Description = string.Format("{0:N0} files ({1}) in {2}. Matched {3:N0}, new {4:N0}, changed {5:N0}, modified {6:N0}, missing {7:N0}, unreadable {8:N0}.",
                            s.Total, Fmt.Bytes(s.BytesTotal), Fmt.Duration(((s.Ended ?? DateTime.UtcNow) - s.Started).TotalSeconds), s.Matched, s.New, s.Changed, s.Modified, s.Missing, s.Unreadable),
                        Date = DateTimeOffset.UtcNow,
                        Severity = problems == 0 ? LogSeverity.Info : LogSeverity.Warn
                    });
                if (c.NotifyProblems && problems > 0)
                {
                    var list = Store.ScanFindings(s.Id, 15);
                    _notifications.SendNotification(new global::Emby.Notifications.NotificationRequest
                    {
                        EventId = IntegrityNotifications.ProblemsEventId,
                        Title = string.Format("Media Integrity: {0} file{1} need attention", problems, problems == 1 ? "" : "s"),
                        Description = string.Join("\n", list.Select(f => f.Status + ": " + f.Path)) + (problems > list.Count ? "\n… and " + (problems - list.Count) + " more (see the Problems tab)" : ""),
                        Date = DateTimeOffset.UtcNow,
                        Severity = LogSeverity.Warn
                    });
                }
            }
            catch (Exception ex) { _log.ErrorException("Media Integrity: notification failed", ex); }
        }

        // ---------------- background queue ----------------
        private void OnItemAdded(object sender, ItemChangeEventArgs e)
        {
            try
            {
                var item = e?.Item;
                if (item == null) return;
                RequestDiscovery("library change", 60000);
                if (!item.IsFileProtocol || string.IsNullOrEmpty(item.Path) || !Cfg.HashNewItems) return;
                if (item is MediaBrowser.Controller.Entities.CollectionFolder || item is MediaBrowser.Controller.Entities.AggregateFolder) return;
                var roots = Roots();
                if (!roots.Any(r => item.Path.StartsWith(IntegrityStore.WithSep(r.Path), StringComparison.OrdinalIgnoreCase))) return;
                foreach (var p in ManualCheckQueue.NewItemFiles(item.Path, item is MediaBrowser.Controller.Entities.Folder, ExcludeRegex()))
                    Store.Enqueue(p, "added", DateTime.UtcNow.AddMinutes(2), DateTime.UtcNow);
            }
            catch (Exception ex) { _log.ErrorException("Media Integrity: queue new item", ex); }
        }

        /// <summary>Closes the Activity entry of a manual check job (combined batches are one entry).</summary>
        private void LogJob(CheckJob j)
        {
            try
            {
                if (j.LogId == null) return;
                var s = Store.GetScan(j.LogId.Value); if (s == null) return;
                s.State = j.State == "done" ? "completed" : j.State == "cancelled" ? "stopped" : j.State;
                s.Ended = j.Ended ?? DateTime.UtcNow; s.Label = j.Label;
                s.Total = j.Total; s.Done = j.Done; s.BytesTotal = j.BytesTotal; s.BytesDone = j.BytesDone; s.BytesHashed = j.BytesDone;
                s.Matched = j.Ok; s.New = j.New; s.Changed = j.Changed; s.Modified = j.Modified; s.Missing = j.Missing; s.Unreadable = j.Unreadable;
                s.ActiveSeconds = ((s.Ended ?? DateTime.UtcNow) - s.Started).TotalSeconds;
                s.Note = (j.Batches > 1 ? j.Batches + " batches combined" : "") + (j.Absent > 0 ? (j.Batches > 1 ? "; " : "") + j.Absent + " not on disk (untracked)" : "");
                Store.SaveScan(s);
            }
            catch (Exception ex) { _log.ErrorException("Media Integrity: activity entry", ex); }
        }

        /// <summary>New library items are rolled up into one Activity entry per day instead of one per file.</summary>
        private void LogNewMedia(ScanRecord log, ScanEngine.Outcome o, long bytes)
        {
            if (log == null) return;
            try
            {
                var s = Store.GetScan(log.Id); if (s == null) return;
                s.Total++; s.Done++; s.BytesTotal += bytes; s.BytesDone += bytes; s.Ended = DateTime.UtcNow; s.State = "completed";
                switch (o?.Result)
                {
                    case "new": case CheckResult.Baseline: s.New++; break;
                    case CheckResult.Match: case CheckResult.ModifiedAccepted: s.Matched++; break;
                    case CheckResult.Changed: s.Changed++; break;
                    case CheckResult.Modified: s.Modified++; break;
                    case CheckResult.Missing: s.Missing++; break;
                    default: s.Unreadable++; break;
                }
                Store.SaveScan(s);
            }
            catch { }
        }

        // ---------------- manual checks ----------------
        private System.Text.RegularExpressions.Regex ExcludeRegex() => ScanEngine.GlobsToRegex(Cfg.Exclude ?? new string[0]);

        public CheckJob CheckPaths(string label, IList<string> files, IList<string> dirs, bool companions, string source = "manual")
        {
            var paths = ManualCheckQueue.ExpandTargets(files, dirs, ExcludeRegex(), d => Store.PathsUnder(d, null), companions);
            return Snap(Manual.Enqueue(label, paths, source));
        }
        /// <summary>Serializable snapshot of a job (the live object keeps changing on the worker thread).</summary>
        public CheckJob Snap(CheckJob j) => Manual.Get(j.Id, int.MaxValue) ?? j;

        /// <summary>Files of a library item: a file item with its companions (.nfo, subtitles, artwork); a folder item
        /// (series, season, folder, library) recursively by its folder on disk, else by its children's files.</summary>
        public CheckJob CheckItems(IEnumerable<string> ids)
        {
            var files = new List<string>(); var dirs = new List<string>(); var names = new List<string>();
            var dataPath = _config.ApplicationPaths.ProgramDataPath;
            bool Usable(string p) => !string.IsNullOrWhiteSpace(p) && !p.StartsWith(dataPath, StringComparison.OrdinalIgnoreCase);
            foreach (var id in ids)
            {
                MediaBrowser.Controller.Entities.BaseItem item = null;
                if (long.TryParse(id, out var internalId)) item = _library.GetItemById(internalId);
                if (item == null) item = _library.GetItemById(id);
                if (item == null) continue;
                names.Add(item.Name);
                if (item is MediaBrowser.Controller.Entities.Folder folder)
                {
                    var locs = new List<string>();
                    try { if (folder.GetType().GetProperty("PhysicalLocations")?.GetValue(folder) is IEnumerable<string> pl) locs.AddRange(pl.Where(Usable).Where(Directory.Exists)); } catch { } // libraries (CollectionFolder) list their folders here
                    if (locs.Count == 0 && Usable(item.Path) && Directory.Exists(item.Path)) locs.Add(item.Path);
                    if (locs.Count > 0) { dirs.AddRange(locs); continue; }
                    var kids = _library.GetItemList(new MediaBrowser.Controller.Entities.InternalItemsQuery { AncestorIds = new[] { item.InternalId }, Recursive = true, IsFolder = false });
                    foreach (var c in kids) if (c.IsFileProtocol && Usable(c.Path)) { if (Directory.Exists(c.Path)) dirs.Add(c.Path); else files.Add(c.Path); }
                }
                else if (item.IsFileProtocol && Usable(item.Path))
                {
                    if (Directory.Exists(item.Path)) dirs.Add(item.Path); else files.Add(item.Path); // disc folders (BDMV / VIDEO_TS) are directories
                }
            }
            var label = names.Count == 0 ? "Item check" : names.Count == 1 ? names[0] : names[0] + " and " + (names.Count - 1) + " more";
            return CheckPaths(label, files, dirs, true, "item");
        }

        public void Recheck(FileRecord f) { Store.Enqueue(f.Path, "recheck", DateTime.UtcNow, DateTime.UtcNow); _queueWake.Set(); }

        private void QueueLoop()
        {
            while (!_disposed)
            {
                _queueWake.WaitOne(30000);
                if (_disposed) break;
                try
                {
                    while (!_disposed)
                    {
                        var q = Store.NextQueued(DateTime.UtcNow);
                        if (q == null) break;
                        var (id, path, reason, attempts) = q.Value;
                        // still being copied? wait until it has been quiet for a minute
                        try
                        {
                            var fi = new FileInfo(path);
                            if (fi.Exists && (DateTime.UtcNow - fi.LastWriteTimeUtc).TotalSeconds < 60 && attempts < 60) { Store.Postpone(id, DateTime.UtcNow.AddMinutes(2)); continue; }
                        }
                        catch { }
                        QueueCurrent = path;
                        try
                        {
                            var log = reason == "added" ? Store.NewMediaLog(DateTime.UtcNow) : null;
                            long len = 0; try { len = new FileInfo(path).Length; } catch { }
                            var o = Engine.CheckFile(path, reason, null, QueueGate, CancellationToken.None, null, null, log?.Id);
                            LogNewMedia(log, o, len);
                        }
                        catch (Exception ex) { _log.ErrorException("Media Integrity: hashing " + path, ex); }
                        finally { QueueCurrent = null; }
                        Store.Dequeue(id);
                    }
                }
                catch (Exception ex) { if (!_disposed) _log.ErrorException("Media Integrity queue", ex); }
            }
        }
    }

    public static class Fmt
    {
        public static string Bytes(double b)
        {
            string[] u = { "B", "KB", "MB", "GB", "TB", "PB" }; int i = 0;
            while (b >= 1024 && i < u.Length - 1) { b /= 1024; i++; }
            return (i == 0 ? b.ToString("0") : b.ToString("0.##")) + " " + u[i];
        }
        public static string Duration(double s)
        {
            var t = TimeSpan.FromSeconds(Math.Max(0, s));
            if (t.TotalDays >= 1) return string.Format("{0}d {1}h", (int)t.TotalDays, t.Hours);
            if (t.TotalHours >= 1) return string.Format("{0}h {1}m", (int)t.TotalHours, t.Minutes);
            return string.Format("{0}m {1}s", t.Minutes, t.Seconds);
        }
    }
}
