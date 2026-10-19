using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Claw.Emby.MediaIntegrity.Core
{
    public sealed class MigrateResult
    {
        public int Done { get; set; }
        public int Skipped { get; set; }
        public List<string> Errors { get; set; } = new List<string>();
        /// <summary>Activity entry of this migration.</summary>
        public long? LogId { get; set; }
    }

    /// <summary>
    /// "Find moved files", Migrate / Ignore of the results and Relink of single missing files. Searches and relinks run as jobs of the
    /// manual check queue (same progress panel, same speed limit, refused while the plugin is switched off). The last search result
    /// is kept in the database (meta "moves") so the page shows it after a reload.
    /// </summary>
    public sealed class MoveService
    {
        private readonly IntegrityStore _store;
        private readonly ManualCheckQueue _queue;
        private readonly Func<Regex> _exclude;
        private readonly Func<DateTime> _now;
        private readonly object _l = new object();
        private MoveSearch _last;
        /// <summary>Hashes computed by relinks (path|size|mtime → md5), so "Relink anyway" does not hash the file twice.</summary>
        private readonly Dictionary<string, string> _relinkHashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public Func<bool> IsEnabled { get; set; } = () => true;
        public Action<string> Log { get; set; }

        public MoveService(IntegrityStore store, ManualCheckQueue queue, Func<Regex> exclude, Func<DateTime> now = null)
        {
            _store = store; _queue = queue; _exclude = exclude ?? (() => null); _now = now ?? (() => DateTime.UtcNow);
            try { _last = System.Text.Json.JsonSerializer.Deserialize<MoveSearch>(_store.GetMeta("moves") ?? "null"); } catch { _last = null; }
        }

        private void Save() { try { _store.SetMeta("moves", System.Text.Json.JsonSerializer.Serialize(_last)); } catch { } }
        private void On() { if (!IsEnabled()) throw new ArgumentException(ManualCheckQueue.OffMessage); }

        /// <summary>Last search, with matches that are no longer actionable (record no longer missing) marked.</summary>
        public MoveSearch Last()
        {
            lock (_l)
            {
                if (_last == null) return null;
                var c = System.Text.Json.JsonSerializer.Deserialize<MoveSearch>(System.Text.Json.JsonSerializer.Serialize(_last));
                foreach (var m in c.Matches.Where(x => x.State == "pending"))
                {
                    var f = _store.GetFile(m.FileId);
                    if (f == null || f.Status != FileStatus.Missing) m.State = f != null && string.Equals(f.Path, m.NewPath, StringComparison.OrdinalIgnoreCase) ? "migrated" : "resolved";
                }
                return c;
            }
        }

        public void Clear() { lock (_l) { _last = null; _store.SetMeta("moves", "null"); } }

        /// <summary>Queues a search for the given missing ids (none = every missing file), also looking in extra folders.</summary>
        public CheckJob Find(IList<long> ids, IList<string> folders)
        {
            On();
            var n = _store.MissingFiles(ids).Count;
            var label = "Find moved files (" + n + " missing file" + (n == 1 ? "" : "s") + ")";
            return _queue.EnqueueWork(label, "moves", "moves", ctx =>
            {
                lock (_l) { _last = new MoveSearch { JobId = ctx.Job.Id, Started = _now(), MissingSearched = n, State = "running" }; Save(); }
                MoveSearch res;
                try { res = MoveFinder.Find(_store, ids, folders, _exclude(), (p, size) => ctx.Hash(p, size), (files, bytes) => ctx.AddWork(files, bytes), _now); }
                catch (OperationCanceledException) { lock (_l) { if (_last != null) { _last.State = "cancelled"; _last.Ended = _now(); } Save(); } throw; }
                res.JobId = ctx.Job.Id;
                ctx.Update(j => { j.Ok = res.Exact; j.New = res.Likely; j.Absent = res.NoMatch; j.Outcome = "found";
                    j.Message = res.Exact + " exact, " + res.Likely + " likely, " + res.NoMatch + " not found (" + res.Hashed + " candidate" + (res.Hashed == 1 ? "" : "s") + " hashed)"; });
                lock (_l) { _last = res; Save(); }
                Log?.Invoke("find moved files: " + n + " missing, " + res.Candidates + " candidates, " + res.Hashed + " hashed, " + res.Exact + " exact, " + res.Likely + " likely");
            });
        }

        /// <summary>Migrates confirmed matches of the last search (ids = missing file ids; null = all confirmed, still pending).</summary>
        public MigrateResult Migrate(IList<long> ids)
        {
            On();
            var res = new MigrateResult();
            lock (_l)
            {
                if (_last == null) { res.Errors.Add("no search result"); return res; }
                var todo = _last.Matches.Where(m => m.State == "pending" && m.Verified && (ids == null || ids.Count == 0 || ids.Contains(m.FileId))).ToList();
                if (ids != null) res.Skipped += ids.Count(i => !todo.Any(m => m.FileId == i));
                if (todo.Count == 0) return res;
                var now = _now();
                var log = _store.NewScan("move", now, null, todo.Count == 1 ? "Moved: " + Path.GetFileName(todo[0].NewPath) : "Migrated " + todo.Count + " moved files", "migrate");
                res.LogId = log.Id;
                foreach (var m in todo)
                {
                    var stale = MoveFinder.Stale(m);
                    if (stale != null) { res.Skipped++; res.Errors.Add(Path.GetFileName(m.OldPath) + ": " + stale + " (search again)"); continue; }
                    try { _store.MoveRecord(m.FileId, m.NewPath, m.Md5, false, "move", log.Id, now); m.State = "migrated"; res.Done++; }
                    catch (ArgumentException ex) { res.Skipped++; res.Errors.Add(Path.GetFileName(m.OldPath) + ": " + ex.Message); }
                }
                log.State = "completed"; log.Ended = _now(); log.Total = todo.Count; log.Done = res.Done; log.Matched = res.Done; log.BytesTotal = todo.Sum(m => m.Size);
                log.Note = res.Done + " record" + (res.Done == 1 ? "" : "s") + " moved with their history" + (res.Skipped > 0 ? "; " + res.Skipped + " skipped" : "");
                _store.SaveScan(log);
                Save();
            }
            _store.RefreshMoveHints();
            return res;
        }

        /// <summary>Not the same file: forget this pair (search results and the scan hint never suggest it again).</summary>
        public int Ignore(long fileId, string newPath)
        {
            int n = 0;
            lock (_l)
            {
                if (string.IsNullOrWhiteSpace(newPath)) newPath = _last?.Matches.FirstOrDefault(m => m.FileId == fileId && m.State == "pending")?.NewPath ?? _store.GetFile(fileId)?.MoveHint;
                if (string.IsNullOrWhiteSpace(newPath)) return 0;
                _store.IgnoreMove(fileId, newPath, _now());
                if (_last != null) foreach (var m in _last.Matches.Where(m => m.FileId == fileId && string.Equals(m.NewPath, newPath, StringComparison.OrdinalIgnoreCase))) { m.State = "ignored"; n++; }
                Save();
            }
            _store.RefreshMoveHints();
            return Math.Max(n, 1);
        }

        private static string Key(FileInfo fi) => fi.FullName + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks;

        /// <summary>Relink one missing file to a path the user entered: hash it (job), migrate when the hash matches the baseline.
        /// force: migrate even when it differs (the new hash becomes the baseline).</summary>
        public CheckJob Relink(long fileId, string newPath, bool force)
        {
            On();
            var f = _store.GetFile(fileId) ?? throw new ArgumentException("file " + fileId + " is not tracked");
            if (f.Status != FileStatus.Missing) throw new ArgumentException(f.Name + " is not missing");
            newPath = (newPath ?? "").Trim().Trim('"');
            if (newPath.Length == 0) throw new ArgumentException("enter the new path");
            FileInfo fi;
            try { fi = new FileInfo(newPath); } catch (Exception ex) { throw new ArgumentException("bad path: " + ex.Message); }
            if (!fi.Exists) throw new ArgumentException("file not found: " + newPath);
            var other = _store.GetFile(fi.FullName);
            if (other != null && other.Status != FileStatus.Pending && other.Status != FileStatus.NeverHashed && !_store.IsNewish(other, f))
                throw new ArgumentException("that path is already tracked with its own history (" + other.Status + "); a copy, not a move");
            var job = _queue.EnqueueWork("Relink " + f.Name, "relink", "relink", ctx =>
            {
                ctx.Update(j => j.TargetId = fileId);
                string md5; var key = Key(fi);
                lock (_l) _relinkHashes.TryGetValue(key, out md5);
                if (md5 == null)
                {
                    var o = ctx.Hash(fi.FullName, fi.Length);
                    if (!o.Ok) { ctx.Update(j => { j.Outcome = "error"; j.Message = "could not read the file: " + o.Error; j.Unreadable = 1; }); return; }
                    md5 = o.Md5; lock (_l) _relinkHashes[key] = md5;
                }
                else ctx.Update(j => j.Done = j.Total);
                var same = md5 == IntegrityStore.NormHash(f.BaselineMd5);
                ctx.Update(j => j.Hash = md5);
                if (!same && !force)
                {
                    ctx.Update(j => { j.Outcome = "mismatch"; j.Changed = 1; j.Message = "The hash of " + fi.Name + " (" + md5 + ") differs from the baseline of " + f.Name + " (" + (f.BaselineMd5 ?? "none") + "). Not relinked."; });
                    return;
                }
                _store.MoveRecord(fileId, fi.FullName, md5, force, "relink", ctx.Job.LogId, _now());
                lock (_l) { _relinkHashes.Remove(key); if (_last != null) foreach (var m in _last.Matches.Where(m => m.FileId == fileId && m.State == "pending")) m.State = "migrated"; Save(); }
                _store.RefreshMoveHints();
                ctx.Update(j => { j.Outcome = "migrated"; j.Ok = 1; j.Message = same ? "Relinked: hash matches the baseline." : "Relinked anyway: the new hash is now the baseline."; });
            }, 1, fi.Length);
            return job;
        }
    }
}
