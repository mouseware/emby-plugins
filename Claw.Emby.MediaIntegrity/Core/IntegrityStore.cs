using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace Claw.Emby.MediaIntegrity.Core
{
    /// <summary>The plugin's own SQLite database (data\claw-mediaintegrity\integrity.db). Every query is parameterized.</summary>
    public sealed class IntegrityStore : IDisposable
    {
        public const int SchemaVersion = 1;
        public SqliteDb Db { get; }

        public IntegrityStore(string dbPath)
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dbPath));
            Db = new SqliteDb(dbPath);
            Db.ExecScript("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON");
            Migrate();
        }

        private void Migrate()
        {
            Db.ExecScript(@"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE COLLATE NOCASE,
  folder TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL COLLATE NOCASE,
  ext TEXT COLLATE NOCASE,
  size INTEGER, mtime TEXT,
  baseline_md5 TEXT, baseline_size INTEGER, baseline_mtime TEXT, baseline_date TEXT,
  last_md5 TEXT, last_checked TEXT, last_result TEXT,
  status TEXT NOT NULL,
  ignored INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT, last_seen TEXT, last_scan_id INTEGER,
  legacy_id INTEGER, error TEXT);
CREATE INDEX IF NOT EXISTS ix_files_status ON files(status, ignored);
CREATE INDEX IF NOT EXISTS ix_files_folder ON files(folder);
CREATE INDEX IF NOT EXISTS ix_files_scan ON files(last_scan_id);
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  time TEXT NOT NULL, md5 TEXT, size INTEGER, seconds REAL,
  result TEXT NOT NULL, source TEXT NOT NULL, scan_id INTEGER, note TEXT);
CREATE INDEX IF NOT EXISTS ix_checks_file ON checks(file_id, time);
CREATE INDEX IF NOT EXISTS ix_checks_scan ON checks(scan_id);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, state TEXT NOT NULL, started TEXT NOT NULL, ended TEXT,
  total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
  bytes_total INTEGER NOT NULL DEFAULT 0, bytes_done INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0, changed INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL DEFAULT 0,
  new INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0, unreadable INTEGER NOT NULL DEFAULT 0,
  position TEXT, roots TEXT, note TEXT, active_seconds REAL NOT NULL DEFAULT 0, bytes_hashed REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE COLLATE NOCASE,
  reason TEXT NOT NULL, added TEXT NOT NULL, not_before TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)");
            if (GetMeta("schema") == null) SetMeta("schema", SchemaVersion.ToString());
        }

        public string GetMeta(string key) => Db.Scalar("SELECT value FROM meta WHERE key=@k", ("k", key)) as string;
        public void SetMeta(string key, string value) => Db.Exec("INSERT INTO meta(key,value) VALUES(@k,@v) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("k", key), ("v", value));

        // ---------------- files ----------------
        public static string FolderOf(string path) { var d = System.IO.Path.GetDirectoryName(path); return string.IsNullOrEmpty(d) ? path : d; }
        public static string NormHash(string h) => string.IsNullOrWhiteSpace(h) ? null : h.Trim().ToUpperInvariant();

        private const string FileCols = "id,path,folder,name,ext,size,mtime,baseline_md5,baseline_size,baseline_mtime,baseline_date,last_md5,last_checked,last_result,status,ignored,first_seen,last_seen,last_scan_id,legacy_id,error";

        public static FileRecord ToFile(Row r) => new FileRecord
        {
            Id = r.Long("id"), Path = r.Str("path"), Folder = r.Str("folder"), Name = r.Str("name"), Ext = r.Str("ext"),
            Size = r.LongN("size"), Mtime = Time.FromDb(r.Str("mtime")),
            BaselineMd5 = r.Str("baseline_md5"), BaselineSize = r.LongN("baseline_size"), BaselineMtime = Time.FromDb(r.Str("baseline_mtime")), BaselineDate = Time.FromDb(r.Str("baseline_date")),
            LastMd5 = r.Str("last_md5"), LastChecked = Time.FromDb(r.Str("last_checked")), LastResult = r.Str("last_result"),
            Status = r.Str("status"), Ignored = r.Long("ignored") != 0, FirstSeen = Time.FromDb(r.Str("first_seen")), LastSeen = Time.FromDb(r.Str("last_seen")),
            LastScanId = r.LongN("last_scan_id"), LegacyId = r.LongN("legacy_id"), Error = r.Str("error")
        };

        public FileRecord GetFile(string path) => Db.Query("SELECT " + FileCols + " FROM files WHERE path=@p", ("p", path)).Select(ToFile).FirstOrDefault();
        public FileRecord GetFile(long id) => Db.Query("SELECT " + FileCols + " FROM files WHERE id=@id", ("id", id)).Select(ToFile).FirstOrDefault();

        public long InsertFile(FileRecord f)
        {
            lock (Db.SyncRoot)
            {
                Db.Exec(@"INSERT INTO files(path,folder,name,ext,size,mtime,baseline_md5,baseline_size,baseline_mtime,baseline_date,last_md5,last_checked,last_result,status,ignored,first_seen,last_seen,last_scan_id,legacy_id,error)
                          VALUES(@path,@folder,@name,@ext,@size,@mtime,@bmd5,@bsize,@bmtime,@bdate,@lmd5,@lchk,@lres,@status,@ign,@first,@seen,@scan,@legacy,@err)", FileArgs(f));
                f.Id = Db.LastInsertId;
                return f.Id;
            }
        }

        public void UpdateFile(FileRecord f)
        {
            Db.Exec(@"UPDATE files SET size=@size,mtime=@mtime,baseline_md5=@bmd5,baseline_size=@bsize,baseline_mtime=@bmtime,baseline_date=@bdate,last_md5=@lmd5,last_checked=@lchk,
                      last_result=@lres,status=@status,ignored=@ign,first_seen=@first,last_seen=@seen,last_scan_id=@scan,error=@err WHERE id=@id", FileArgs(f).Append(("id", f.Id)).ToArray());
        }

        private static (string, object)[] FileArgs(FileRecord f) => new (string, object)[]
        {
            ("path", f.Path), ("folder", f.Folder ?? FolderOf(f.Path)), ("name", f.Name ?? System.IO.Path.GetFileName(f.Path)), ("ext", f.Ext ?? System.IO.Path.GetExtension(f.Path)),
            ("size", f.Size), ("mtime", f.Mtime), ("bmd5", f.BaselineMd5), ("bsize", f.BaselineSize), ("bmtime", f.BaselineMtime), ("bdate", f.BaselineDate),
            ("lmd5", f.LastMd5), ("lchk", f.LastChecked), ("lres", f.LastResult), ("status", f.Status), ("ign", f.Ignored), ("first", f.FirstSeen), ("seen", f.LastSeen),
            ("scan", f.LastScanId), ("legacy", f.LegacyId), ("err", f.Error)
        };

        public void AddCheck(CheckRecord c)
        {
            Db.Exec("INSERT INTO checks(file_id,time,md5,size,seconds,result,source,scan_id,note) VALUES(@f,@t,@m,@s,@sec,@r,@src,@scan,@n)",
                ("f", c.FileId), ("t", c.Time), ("m", c.Md5), ("s", c.Size), ("sec", c.Seconds), ("r", c.Result), ("src", c.Source), ("scan", c.ScanId), ("n", c.Note));
        }

        public List<CheckRecord> History(long fileId, int limit = 200) => Db.Query(
            "SELECT id,file_id,time,md5,size,seconds,result,source,scan_id,note FROM checks WHERE file_id=@f ORDER BY time DESC, id DESC LIMIT @l", ("f", fileId), ("l", limit))
            .Select(r => new CheckRecord
            {
                Id = r.Long("id"), FileId = r.Long("file_id"), Time = Time.FromDb(r.Str("time")) ?? DateTime.MinValue, Md5 = r.Str("md5"), Size = r.LongN("size"),
                Seconds = r.TryGetValue("seconds", out var s) && s != null ? Convert.ToDouble(s) : (double?)null, Result = r.Str("result"), Source = r.Str("source"),
                ScanId = r.LongN("scan_id"), Note = r.Str("note")
            }).ToList();

        public bool DeleteFile(long id) => Db.Exec("DELETE FROM files WHERE id=@id", ("id", id)) > 0;
        public void SetIgnored(long id, bool ignored) => Db.Exec("UPDATE files SET ignored=@i WHERE id=@id", ("i", ignored), ("id", id));

        /// <summary>Accept the latest hash as the new baseline (file was legitimately changed).</summary>
        public bool AcceptCurrent(long id, DateTime now)
        {
            var f = GetFile(id);
            if (f == null || string.IsNullOrEmpty(f.LastMd5) || f.Status == FileStatus.Missing || f.Status == FileStatus.Unreadable) return false;
            f.BaselineMd5 = f.LastMd5; f.BaselineSize = f.Size; f.BaselineMtime = f.Mtime; f.BaselineDate = now;
            f.Status = FileStatus.Ok; f.LastResult = CheckResult.Accepted; f.Error = null;
            Db.Transaction(() => { UpdateFile(f); AddCheck(new CheckRecord { FileId = id, Time = now, Md5 = f.LastMd5, Size = f.Size, Result = CheckResult.Accepted, Source = "user" }); });
            return true;
        }

        public Dictionary<string, long> StatusCounts(bool includeIgnored = false)
        {
            var d = new Dictionary<string, long>();
            foreach (var r in Db.Query("SELECT status, ignored, COUNT(*) n FROM files GROUP BY status, ignored"))
            {
                var s = r.Str("status");
                if (r.Long("ignored") != 0) { d["ignored"] = (d.TryGetValue("ignored", out var i) ? i : 0) + r.Long("n"); if (!includeIgnored) continue; }
                d[s] = (d.TryGetValue(s, out var v) ? v : 0) + r.Long("n");
            }
            return d;
        }

        public long FileCount => Db.ScalarLong("SELECT COUNT(*) FROM files");
        public long CheckCount => Db.ScalarLong("SELECT COUNT(*) FROM checks");

        public List<FileRecord> Problems(bool includeIgnored, int limit = 5000)
        {
            var sql = "SELECT " + FileCols + " FROM files WHERE status IN ('changed','modified','missing','unreadable')" + (includeIgnored ? "" : " AND ignored=0") +
                      " ORDER BY CASE status WHEN 'changed' THEN 0 WHEN 'unreadable' THEN 1 WHEN 'missing' THEN 2 ELSE 3 END, last_checked DESC LIMIT @l";
            return Db.Query(sql, ("l", limit)).Select(ToFile).ToList();
        }

        /// <summary>One row per folder (for grouping in C#): count, bytes, status counts.</summary>
        public List<Row> FolderStats() => Db.Query(@"SELECT folder, COUNT(*) n, COALESCE(SUM(size),0) bytes,
             SUM(status='ok') ok, SUM(status IN ('changed','modified','missing','unreadable') AND ignored=0) problems, SUM(status IN ('pending','never_hashed')) pending,
             MIN(last_checked) oldest, MAX(last_checked) newest FROM files GROUP BY folder");

        /// <summary>Files under any of <paramref name="prefixes"/> (or outside all of <paramref name="notUnder"/>), paged and searchable.</summary>
        public PagedFiles Browse(IList<string> prefixes, IList<string> notUnder, string search, string status, string sort, bool desc, int offset, int limit)
        {
            var where = new List<string>(); var args = new List<(string, object)>();
            if (prefixes != null && prefixes.Count > 0)
            {
                var ors = new List<string>();
                for (int i = 0; i < prefixes.Count; i++) { ors.Add("substr(path,1,@pl" + i + ")=@p" + i + " COLLATE NOCASE"); var p = WithSep(prefixes[i]); args.Add(("p" + i, p)); args.Add(("pl" + i, (long)p.Length)); }
                where.Add("(" + string.Join(" OR ", ors) + ")");
            }
            if (notUnder != null)
                for (int i = 0; i < notUnder.Count; i++) { var p = WithSep(notUnder[i]); where.Add("substr(path,1,@nl" + i + ")<>@n" + i + " COLLATE NOCASE"); args.Add(("n" + i, p)); args.Add(("nl" + i, (long)p.Length)); }
            if (!string.IsNullOrWhiteSpace(search)) { where.Add("path LIKE @q ESCAPE '\\'"); args.Add(("q", "%" + LikeEscape(search.Trim()) + "%")); }
            if (!string.IsNullOrEmpty(status))
            {
                if (status == "problems") where.Add("status IN ('changed','modified','missing','unreadable') AND ignored=0");
                else if (status == "ignored") where.Add("ignored=1");
                else if (status == "pending") where.Add("status IN ('pending','never_hashed')");
                else { where.Add("status=@st"); args.Add(("st", status)); }
            }
            var w = where.Count > 0 ? " WHERE " + string.Join(" AND ", where) : "";
            string col;
            switch ((sort ?? "").ToLowerInvariant())
            {
                case "size": col = "size"; break;
                case "hash": col = "baseline_md5"; break;
                case "checked": col = "last_checked"; break;
                case "status": col = "status"; break;
                case "folder": col = "folder"; break;
                default: col = "name"; break;
            }
            limit = Math.Max(1, Math.Min(limit, 500)); offset = Math.Max(0, offset);
            var total = Db.ScalarLong("SELECT COUNT(*) FROM files" + w, args.ToArray());
            args.Add(("lim", (long)limit)); args.Add(("off", (long)offset));
            var items = Db.Query("SELECT " + FileCols + " FROM files" + w + " ORDER BY " + col + (desc ? " DESC" : " ASC") + ", path LIMIT @lim OFFSET @off", args.ToArray()).Select(ToFile).ToList();
            return new PagedFiles { Total = total, Offset = offset, Items = items };
        }

        public static string WithSep(string p)
        {
            if (string.IsNullOrEmpty(p)) return p;
            return p.EndsWith("\\") || p.EndsWith("/") ? p : p + (p.Contains("/") && !p.Contains("\\") ? "/" : "\\");
        }
        public static string LikeEscape(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

        /// <summary>Ids of files under <paramref name="root"/> that the scan <paramref name="scanId"/> did not visit.</summary>
        public List<FileRecord> NotVisitedUnder(string root, long scanId)
        {
            var p = WithSep(root);
            return Db.Query("SELECT " + FileCols + " FROM files WHERE substr(path,1,@pl)=@p COLLATE NOCASE AND (last_scan_id IS NULL OR last_scan_id<>@s) AND status<>'missing'",
                ("p", p), ("pl", (long)p.Length), ("s", scanId)).Select(ToFile).ToList();
        }

        // ---------------- scans ----------------
        private const string ScanCols = "id,kind,state,started,ended,total,done,bytes_total,bytes_done,matched,changed,modified,new,missing,unreadable,position,roots,note,active_seconds,bytes_hashed";
        private static ScanRecord ToScan(Row r) => new ScanRecord
        {
            Id = r.Long("id"), Kind = r.Str("kind"), State = r.Str("state"), Started = Time.FromDb(r.Str("started")) ?? DateTime.MinValue, Ended = Time.FromDb(r.Str("ended")),
            Total = r.Long("total"), Done = r.Long("done"), BytesTotal = r.Long("bytes_total"), BytesDone = r.Long("bytes_done"), Matched = r.Long("matched"),
            Changed = r.Long("changed"), Modified = r.Long("modified"), New = r.Long("new"), Missing = r.Long("missing"), Unreadable = r.Long("unreadable"),
            Position = r.Str("position"), Roots = r.Str("roots"), Note = r.Str("note"), ActiveSeconds = r.Dbl("active_seconds"), BytesHashed = r.Dbl("bytes_hashed")
        };

        public ScanRecord NewScan(string kind, DateTime now, string roots)
        {
            lock (Db.SyncRoot)
            {
                Db.Exec("INSERT INTO scans(kind,state,started,roots) VALUES(@k,'running',@t,@r)", ("k", kind), ("t", now), ("r", roots));
                return GetScan(Db.LastInsertId);
            }
        }
        public ScanRecord GetScan(long id) => Db.Query("SELECT " + ScanCols + " FROM scans WHERE id=@id", ("id", id)).Select(ToScan).FirstOrDefault();
        public ScanRecord ResumableScan(string kind) => Db.Query("SELECT " + ScanCols + " FROM scans WHERE kind=@k AND state IN ('running','paused','stopped','interrupted') ORDER BY id DESC LIMIT 1", ("k", kind)).Select(ToScan).FirstOrDefault();
        public List<ScanRecord> Scans(int limit = 100) => Db.Query("SELECT " + ScanCols + " FROM scans ORDER BY id DESC LIMIT @l", ("l", limit)).Select(ToScan).ToList();
        public void SaveScan(ScanRecord s) => Db.Exec(@"UPDATE scans SET state=@state,ended=@ended,total=@total,done=@done,bytes_total=@bt,bytes_done=@bd,matched=@m,changed=@c,modified=@mo,new=@n,missing=@mi,
            unreadable=@u,position=@pos,roots=@roots,note=@note,active_seconds=@as,bytes_hashed=@bh WHERE id=@id",
            ("state", s.State), ("ended", s.Ended), ("total", s.Total), ("done", s.Done), ("bt", s.BytesTotal), ("bd", s.BytesDone), ("m", s.Matched), ("c", s.Changed), ("mo", s.Modified),
            ("n", s.New), ("mi", s.Missing), ("u", s.Unreadable), ("pos", s.Position), ("roots", s.Roots), ("note", s.Note), ("as", s.ActiveSeconds), ("bh", s.BytesHashed), ("id", s.Id));
        /// <summary>At startup: a scan left 'running'/'paused' by a restart becomes 'interrupted' (it resumes next run).</summary>
        public int MarkInterrupted() => Db.Exec("UPDATE scans SET state='interrupted' WHERE state IN ('running','paused')");
        public List<FileRecord> ScanFindings(long scanId, int limit = 50) => Db.Query("SELECT " + FileCols + @" FROM files WHERE id IN
            (SELECT file_id FROM checks WHERE scan_id=@s AND result IN ('changed','modified','missing','unreadable')) ORDER BY path LIMIT @l", ("s", scanId), ("l", limit)).Select(ToFile).ToList();

        // ---------------- queue ----------------
        public void Enqueue(string path, string reason, DateTime notBefore, DateTime now) =>
            Db.Exec("INSERT INTO queue(path,reason,added,not_before) VALUES(@p,@r,@a,@nb) ON CONFLICT(path) DO UPDATE SET reason=excluded.reason, not_before=MIN(queue.not_before, excluded.not_before)",
                ("p", path), ("r", reason), ("a", now), ("nb", notBefore));
        public (long Id, string Path, string Reason, long Attempts)? NextQueued(DateTime now)
        {
            var r = Db.Query("SELECT id,path,reason,attempts FROM queue WHERE not_before<=@n ORDER BY not_before, id LIMIT 1", ("n", now)).FirstOrDefault();
            return r == null ? ((long, string, string, long)?)null : (r.Long("id"), r.Str("path"), r.Str("reason"), r.Long("attempts"));
        }
        public void Dequeue(long id) => Db.Exec("DELETE FROM queue WHERE id=@id", ("id", id));
        public void Postpone(long id, DateTime notBefore) => Db.Exec("UPDATE queue SET not_before=@nb, attempts=attempts+1 WHERE id=@id", ("nb", notBefore), ("id", id));
        public long QueueLength => Db.ScalarLong("SELECT COUNT(*) FROM queue");

        public void Dispose() => Db.Dispose();
    }
}
