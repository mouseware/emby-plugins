using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Claw.Emby.MediaIntegrity.Core
{
    /// <summary>One proposed move: a missing record and the file that is very likely the same file at a new path.</summary>
    public sealed class MoveMatch
    {
        public long FileId { get; set; }
        public string OldPath { get; set; }
        public string NewPath { get; set; }
        public long Size { get; set; }
        /// <summary>Row tracking the new path today (pending / just hashed), removed on Migrate. Null: the file is not tracked (extra folder).</summary>
        public long? NewFileId { get; set; }
        public string NewStatus { get; set; }
        /// <summary>hash+name (same MD5, same file name) | hash (same MD5, renamed) | name+size (not confirmed: no baseline hash or read error)</summary>
        public string Match { get; set; }
        /// <summary>high | medium | low</summary>
        public string Confidence { get; set; }
        public bool Verified { get; set; }
        public string Md5 { get; set; }
        /// <summary>Size and modified time of the new file when it was hashed (Migrate refuses if it changed since).</summary>
        public DateTime? NewMtime { get; set; }
        /// <summary>Other paths with the same content (copies), shown as a note.</summary>
        public int OtherCopies { get; set; }
        public string Note { get; set; }
        /// <summary>pending | migrated | ignored</summary>
        public string State { get; set; } = "pending";
    }

    public sealed class MoveSearch
    {
        public long JobId { get; set; }
        public DateTime Started { get; set; }
        public DateTime? Ended { get; set; }
        public string State { get; set; } = "running";
        public int MissingSearched { get; set; }
        public int Candidates { get; set; }
        public int Hashed { get; set; }
        public long BytesHashed { get; set; }
        public int Exact { get; set; }
        public int Likely { get; set; }
        public int NoMatch { get; set; }
        public List<string> Folders { get; set; } = new List<string>();
        public List<string> Errors { get; set; } = new List<string>();
        public List<MoveMatch> Matches { get; set; } = new List<MoveMatch>();
    }

    /// <summary>
    /// Finds where missing files went. Candidates are files that are tracked but new (not yet hashed, or only their first hash,
    /// or first seen after the missing file was last seen) plus untracked files in extra search folders, with the same size as the
    /// missing file's baseline. A candidate whose hash is known is compared directly; others are hashed (same file name first;
    /// renamed candidates only for files still unresolved). Read-only: nothing changes until Migrate.
    /// </summary>
    public static class MoveFinder
    {
        public const int MaxRenamedPerFile = 4;

        private sealed class Cand { public string Path; public long Size; public FileRecord Rec; public string Md5; }

        public static bool SameName(string a, string b) => string.Equals(Path.GetFileName(a), Path.GetFileName(b), StringComparison.OrdinalIgnoreCase);
        public static long? RefSize(FileRecord m) => m.BaselineSize ?? m.Size;

        /// <summary>A hash we can trust for a tracked candidate: its last computed MD5 (never the unverified legacy baseline).</summary>
        public static string KnownHash(FileRecord c)
        {
            if (c == null || c.Status == FileStatus.NeverHashed || c.Status == FileStatus.Pending || c.Status == FileStatus.Unreadable || c.LastChecked == null) return null;
            return IntegrityStore.NormHash(c.LastMd5);
        }

        /// <param name="hash">hashes one file (path, size) or returns null on a read error; the job passes its progress-reporting hasher.</param>
        /// <param name="addWork">announces files/bytes to hash (progress totals).</param>
        public static MoveSearch Find(IntegrityStore store, IList<long> missingIds, IList<string> folders, Regex exclude,
            Func<string, long, HashOutcome> hash, Action<int, long> addWork = null, Func<DateTime> now = null)
        {
            now = now ?? (() => DateTime.UtcNow);
            var res = new MoveSearch { Started = now(), Folders = (folders ?? new string[0]).Where(f => !string.IsNullOrWhiteSpace(f)).Select(f => f.Trim()).ToList() };
            var missing = store.MissingFiles(missingIds).Where(m => (RefSize(m) ?? 0) > 0).ToList();
            res.MissingSearched = missing.Count;
            var sizes = new HashSet<long>(missing.Select(m => RefSize(m).Value));
            // tracked candidates
            var bySize = new Dictionary<long, List<Cand>>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in store.WithSizes(sizes))
            {
                if (r.Size == null || r.Ignored) continue;
                if (!seen.Add(r.Path)) continue;
                Add(bySize, new Cand { Path = r.Path, Size = r.Size.Value, Rec = r, Md5 = KnownHash(r) });
            }
            // untracked files in extra search folders (any drive path)
            foreach (var d in res.Folders)
            {
                bool ok; try { ok = Directory.Exists(d); } catch { ok = false; }
                if (!ok) { res.Errors.Add("not found: " + d); continue; }
                foreach (var f in ScanEngine.Enumerate(d, exclude, System.Threading.CancellationToken.None, res.Errors))
                {
                    if (!sizes.Contains(f.Size) || !seen.Add(f.Path)) continue;
                    Add(bySize, new Cand { Path = f.Path, Size = f.Size, Rec = store.GetFile(f.Path) });
                }
            }
            // per missing file: eligible candidates
            var per = new Dictionary<long, List<Cand>>();
            foreach (var m in missing)
            {
                var ign = store.MoveIgnores(m.Id);
                var list = bySize.TryGetValue(RefSize(m).Value, out var l) ? l : new List<Cand>();
                per[m.Id] = list.Where(c => !ign.Contains(c.Path) && (c.Rec == null || (c.Rec.Id != m.Id && store.IsNewish(c.Rec, m))))
                    .OrderByDescending(c => SameName(c.Path, m.Path)).ThenBy(c => c.Path, StringComparer.OrdinalIgnoreCase).ToList();
            }
            res.Candidates = per.Values.SelectMany(v => v).Select(c => c.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count();

            var hashCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var failed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string Md5Of(Cand c)
            {
                if (c.Md5 != null) return c.Md5;
                if (hashCache.TryGetValue(c.Path, out var h)) return h;
                if (failed.Contains(c.Path)) return null;
                var o = hash(c.Path, c.Size);
                res.Hashed++; res.BytesHashed += o?.Bytes ?? 0;
                if (o == null || !o.Ok) { failed.Add(c.Path); if (o?.Error != null && res.Errors.Count < 50) res.Errors.Add(c.Path + ": " + o.Error); return null; }
                hashCache[c.Path] = o.Md5; return o.Md5;
            }
            void Announce(IEnumerable<Cand> cs)
            {
                var need = cs.Where(c => c.Md5 == null).GroupBy(c => c.Path, StringComparer.OrdinalIgnoreCase).Select(g => g.First()).Where(c => !hashCache.ContainsKey(c.Path) && !failed.Contains(c.Path)).ToList();
                if (need.Count > 0) addWork?.Invoke(need.Count, need.Sum(c => c.Size));
            }

            var found = new Dictionary<long, (Cand c, List<Cand> all)>();
            // phase 1: same file name
            var withRef = missing.Where(m => IntegrityStore.NormHash(m.BaselineMd5) != null).ToList();
            var p1 = withRef.SelectMany(m => per[m.Id].Where(c => SameName(c.Path, m.Path))).ToList();
            Announce(p1);
            foreach (var m in withRef)
            {
                var want = IntegrityStore.NormHash(m.BaselineMd5);
                var hits = per[m.Id].Where(c => SameName(c.Path, m.Path) && Md5Of(c) == want).ToList();
                if (hits.Count > 0) found[m.Id] = (hits[0], hits);
            }
            // phase 2: renamed candidates, only for files still unresolved (a few per file)
            var open = withRef.Where(m => !found.ContainsKey(m.Id)).ToList();
            var p2 = open.SelectMany(m => per[m.Id].Where(c => !SameName(c.Path, m.Path)).Take(MaxRenamedPerFile)).ToList();
            Announce(p2);
            foreach (var m in open)
            {
                var want = IntegrityStore.NormHash(m.BaselineMd5);
                var hits = per[m.Id].Where(c => !SameName(c.Path, m.Path)).Take(MaxRenamedPerFile).Where(c => Md5Of(c) == want).ToList();
                if (hits.Count > 0) found[m.Id] = (hits[0], hits);
            }
            // one new path serves one missing record: same-name first, then the oldest record
            var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in missing.OrderByDescending(m => found.TryGetValue(m.Id, out var x) && SameName(x.c.Path, m.Path)).ThenBy(m => m.Id))
            {
                if (found.TryGetValue(m.Id, out var hit))
                {
                    var pick = hit.all.FirstOrDefault(c => !taken.Contains(c.Path));
                    if (pick != null)
                    {
                        taken.Add(pick.Path);
                        var same = SameName(pick.Path, m.Path);
                        res.Matches.Add(Make(m, pick, same ? "hash+name" : "hash", same ? "high" : "medium", true, Md5Of(pick), hit.all.Count - 1,
                            same ? null : "renamed: " + Path.GetFileName(m.Path) + " → " + Path.GetFileName(pick.Path)));
                        res.Exact++; continue;
                    }
                }
                // not confirmed: same name and size only (no baseline hash, read error, or hash differs is NOT listed)
                var want = IntegrityStore.NormHash(m.BaselineMd5);
                var likely = per[m.Id].FirstOrDefault(c => SameName(c.Path, m.Path) && !taken.Contains(c.Path) && (want == null || failed.Contains(c.Path)));
                if (likely != null)
                {
                    taken.Add(likely.Path);
                    res.Matches.Add(Make(m, likely, "name+size", "low", false, null, 0, want == null ? "no baseline hash to confirm" : "could not read the new file"));
                    res.Likely++; continue;
                }
                res.NoMatch++;
            }
            res.Matches = res.Matches.OrderBy(x => x.Verified ? 0 : 1).ThenBy(x => x.OldPath, StringComparer.OrdinalIgnoreCase).ToList();
            res.Ended = now(); res.State = "done";
            return res;
        }

        private static void Add(Dictionary<long, List<Cand>> d, Cand c) { if (!d.TryGetValue(c.Size, out var l)) d[c.Size] = l = new List<Cand>(); l.Add(c); }

        private static MoveMatch Make(FileRecord m, Cand c, string match, string conf, bool verified, string md5, int copies, string note)
        {
            DateTime? mt = null; try { mt = DateTime.SpecifyKind(File.GetLastWriteTimeUtc(c.Path), DateTimeKind.Utc); } catch { }
            return new MoveMatch
            {
                FileId = m.Id, OldPath = m.Path, NewPath = c.Path, Size = c.Size, NewFileId = c.Rec?.Id, NewStatus = c.Rec?.Status ?? "untracked",
                Match = match, Confidence = conf, Verified = verified, Md5 = md5, NewMtime = mt, OtherCopies = copies,
                Note = copies > 0 ? (note == null ? "" : note + "; ") + copies + " other cop" + (copies == 1 ? "y" : "ies") + " with the same content" : note
            };
        }

        /// <summary>Migrate refuses a match whose new file changed (size or modified time) after it was hashed.</summary>
        public static string Stale(MoveMatch x)
        {
            try
            {
                var fi = new FileInfo(x.NewPath);
                if (!fi.Exists) return "the new file is gone";
                if (fi.Length != x.Size) return "the new file changed size";
                if (x.NewMtime.HasValue && Math.Abs((DateTime.SpecifyKind(fi.LastWriteTimeUtc, DateTimeKind.Utc) - x.NewMtime.Value).TotalSeconds) > 2) return "the new file was modified";
            }
            catch (Exception ex) { return ex.Message; }
            return null;
        }
    }
}
