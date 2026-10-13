using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using Claw.Emby.MediaIntegrity.Core;

static class Program
{
    static int pass, fail;
    static void Ok(bool c, string m) { Console.WriteLine((c ? "PASS " : "FAIL ") + m); if (c) pass++; else fail++; }
    static string Tmp() { var d = Path.Combine(Path.GetTempPath(), "mi-test-" + Guid.NewGuid().ToString("N").Substring(0, 8)); Directory.CreateDirectory(d); return d; }
    static void Write(string p, string s) { Directory.CreateDirectory(Path.GetDirectoryName(p)); File.WriteAllText(p, s); }
    static string Md5(string s) => Convert.ToHexString(MD5.HashData(System.Text.Encoding.UTF8.GetBytes(s)));

    class G : IHashGate { public long BytesPerSecond { get; set; } public string PauseReason { get; set; } }

    static int Main(string[] args)
    {
        var keep = new List<string>();
        try
        {
            SqliteBasics(); Hashing(); Import(); Checks(); FullScan(); Browse(); Manual(); Discovery(); ManualTask(); Patcher();
            var legacy = Environment.GetEnvironmentVariable("LEGACY_DB");
            if (!string.IsNullOrEmpty(legacy)) RealDb(legacy, Environment.GetEnvironmentVariable("VERIFY_DIR"));
        }
        catch (Exception ex) { Ok(false, "unexpected: " + ex); }
        Console.WriteLine(pass + " passed, " + fail + " failed");
        return fail == 0 ? 0 : 1;
    }

    sealed class Prog : IProgress<double> { public readonly List<double> V = new List<double>(); public void Report(double v) { lock (V) V.Add(v); } }

    static void ManualTask()
    {
        var d = Tmp();
        var a = Path.Combine(d, "a.bin"); File.WriteAllBytes(a, new byte[3_000_000]);
        var b = Path.Combine(d, "b.bin"); File.WriteAllBytes(b, new byte[3_000_000]);
        var c = Path.Combine(d, "c.bin"); File.WriteAllBytes(c, new byte[3_000_000]);
        using (var s = new IntegrityStore(Path.Combine(d, "t.db")))
        {
            var e = new ScanEngine(s);
            int queuedCalls = 0;
            using (var q = new ManualCheckQueue(e, new G { BytesPerSecond = 6_000_000 }) { Queued = () => Interlocked.Increment(ref queuedCalls) })
            {
                q.Start();
                Ok(q.Percent == 100 && !q.Busy, "idle queue: 100%, not busy");
                q.Enqueue("first", new[] { a, b });
                Ok(queuedCalls == 1, "queuing work asks the host to start the Emby task");
                var prog = new Prog(); var cts = new CancellationTokenSource();
                var t = new Thread(() => ManualCheckQueue.RunWhileBusy(q, cts.Token, prog, 50, 300)); t.Start();
                Thread.Sleep(250);
                q.Enqueue("second batch", new[] { c }); // appended while the task runs
                bool ended = t.Join(15000);
                double[] v; lock (prog.V) v = prog.V.ToArray();
                Ok(ended && !q.Busy, "task ends when the queue is empty");
                Ok(v.Length >= 3 && v.Last() == 100 && v.Take(v.Length - 1).Any(x => x > 0 && x < 100), "task reports overall progress (" + v.Length + " reports, e.g. " + string.Join(",", v.Take(6).Select(x => x.ToString("0"))) + ")");
                Ok(v.Zip(v.Skip(1), (x, y) => y >= x - 0.001).All(z => z), "progress never goes backwards when a batch is appended");
                Ok(s.GetFile(c)?.BaselineMd5 != null, "appended batch processed in the same task run");
                // cancel from the dashboard -> queue cancelled
                File.AppendAllText(a, "x"); File.AppendAllText(b, "x");
                var job = q.Enqueue("to cancel", new[] { a, b, c });
                var cts2 = new CancellationTokenSource(); var prog2 = new Prog();
                var t2 = new Thread(() => ManualCheckQueue.RunWhileBusy(q, cts2.Token, prog2, 50, 300)); t2.Start();
                Thread.Sleep(200); cts2.Cancel();
                Ok(t2.Join(5000), "cancelled task returns");
                Thread.Sleep(500);
                Ok(!q.Busy && (job.State == "cancelled"), "cancelling the task cancels the manual queue (" + job.State + ")");
                // restart on new work
                var prog3 = new Prog(); q.Enqueue("later", new[] { c });
                var t3 = new Thread(() => ManualCheckQueue.RunWhileBusy(q, CancellationToken.None, prog3, 50, 300)); t3.Start();
                Ok(t3.Join(10000) && prog3.V.Count > 0 && queuedCalls == 4, "new work starts a new task run (" + queuedCalls + " start requests)");
            }
        }
    }

    static void Discovery()
    {
        var d = Tmp(); var lib = Path.Combine(d, "BOOKS"); var other = Path.Combine(d, "Movies");
        Directory.CreateDirectory(Path.Combine(lib, "Author", "Book")); Directory.CreateDirectory(other);
        var m4b = Path.Combine(lib, "Author", "Book", "Book.m4b"); File.WriteAllBytes(m4b, new byte[300000]);
        var epub = Path.Combine(lib, "Author", "Book", "Book.epub"); File.WriteAllText(epub, "epub");
        var jpg = Path.Combine(lib, "Author", "Book", "cover.jpg"); File.WriteAllText(jpg, "jpg");
        var tmp = Path.Combine(lib, "Author", "Book", "x.tmp"); File.WriteAllText(tmp, "t");
        var mov = Path.Combine(other, "Known.mkv"); File.WriteAllText(mov, "known");
        var legacy = Path.Combine(other, "Legacy.mkv"); File.WriteAllText(legacy, "legacy");
        using (var s = new IntegrityStore(Path.Combine(d, "i.db")))
        {
            s.InsertFile(new FileRecord { Path = mov, Status = FileStatus.Ok, BaselineMd5 = "AA" });
            s.InsertFile(new FileRecord { Path = legacy, Status = FileStatus.NeverHashed, LegacyId = 7 });
            var roots = new List<ScanRoot> { new ScanRoot(lib, "Audio books"), new ScanRoot(other, "Movies"), new ScanRoot(Path.Combine(d, "Offline"), "Gone") };
            var ex = ScanEngine.GlobsToRegex(new[] { "*.tmp" });
            var r = FileDiscovery.Run(s, roots, ex, "test", CancellationToken.None);
            Ok(r.Roots == 3 && r.RootsOffline == 1 && r.OnDisk == 5 && r.Added == 3, $"discovery: 3 untracked library files added (roots {r.Roots}, offline {r.RootsOffline}, on disk {r.OnDisk}, added {r.Added})");
            var f = s.GetFile(m4b);
            Ok(f != null && f.Status == FileStatus.Pending && f.BaselineMd5 == null && f.Size == 300000, "untracked audiobook listed as not yet hashed (pending), with size");
            Ok(s.GetFile(tmp) == null, "excluded pattern not listed");
            Ok(s.GetFile(mov).Status == FileStatus.Ok && s.GetFile(legacy).Status == FileStatus.NeverHashed, "known rows untouched");
            var pg = s.Browse(new[] { lib }, null, null, "pending", "name", false, 0, 100);
            Ok(pg.Total == 3, "Browse group + status filter 'pending' finds them");
            Ok(s.Browse(null, null, "Book.m4b", null, "name", false, 0, 100).Total == 1, "global search finds untracked file");
            Ok(s.StatusCounts()[FileStatus.Pending] == 3, "counts include untracked files");
            var r2 = FileDiscovery.Run(s, roots, ex, "again", CancellationToken.None);
            Ok(r2.Added == 0 && r2.Removed == 0, "second refresh adds nothing (cached in the db)");
            File.Delete(jpg);
            var r3 = FileDiscovery.Run(s, roots, ex, "deleted", CancellationToken.None);
            Ok(r3.Removed == 1 && s.GetFile(jpg) == null, "never-hashed file deleted from disk is dropped (not reported missing)");
            Ok(s.MatchingPaths(new[] { lib }, null, "Book", "pending").Count == 2 && s.MatchingPaths(null, null, null, null).Count == 4, "MatchingPaths = every file of a filter (select all matching)");
            Ok(s.PendingPaths().Count == 3, "PendingPaths covers pending + never_hashed");
            // hashing: discovered -> "new", imported never_hashed -> leaves never_hashed for good
            var e = new ScanEngine(s);
            var o = e.CheckFile(m4b, "manual", null, new G(), CancellationToken.None);
            Ok(o.Result == "new" && s.GetFile(m4b).Status == FileStatus.Ok && s.GetFile(m4b).BaselineMd5 != null, "Check now on an untracked file stores its first hash (new)");
            Ok(s.StatusCounts().TryGetValue(FileStatus.NeverHashed, out var nh) && nh == 1, "one never-verified imported file before");
            var o2 = e.CheckFile(legacy, "manual", null, new G(), CancellationToken.None);
            var lf = s.GetFile(legacy);
            Ok(lf.Status == FileStatus.Ok && lf.BaselineMd5 != null && !s.StatusCounts().ContainsKey(FileStatus.NeverHashed), "first plugin hash clears never_hashed; count reaches 0 (" + o2.Result + ")");
            File.Delete(legacy);
            var o3 = e.CheckFile(legacy, "manual", null, new G(), CancellationToken.None);
            Ok(s.GetFile(legacy).Status == FileStatus.Missing, "after its first hash the file is a normal tracked file (missing is reported)");
            Ok(ManualCheckQueue.NewItemFiles(Path.Combine(lib, "Author", "Book"), true, ex).Count == 2 && ManualCheckQueue.NewItemFiles(m4b, false, ex).Count == 1, "new item of any type: folder item queues its files, file item itself");
        }
    }

    static void SqliteBasics()
    {
        var d = Tmp();
        using (var s = new IntegrityStore(Path.Combine(d, "a.db")))
        {
            var p = @"E:\TV\Grey's Anatomy\Season 01\Grey's Anatomy - S01E01 - A Hard Day's Night.mkv";
            s.InsertFile(new FileRecord { Path = p, Status = FileStatus.Pending });
            var f = s.GetFile(p);
            Ok(f != null && f.Path == p && f.Name == "Grey's Anatomy - S01E01 - A Hard Day's Night.mkv", "apostrophe path round-trips (old script's bug)");
            Ok(s.GetFile(p.ToUpperInvariant())?.Id == f.Id, "path lookup is case-insensitive (Windows)");
            var u = @"M:\Filme\Amélie (2001)\Amélie — 日本語 '100%'_x.mkv";
            s.InsertFile(new FileRecord { Path = u, Status = FileStatus.Pending });
            Ok(s.GetFile(u)?.Name == "Amélie — 日本語 '100%'_x.mkv", "unicode / % / _ in path");
            Ok(s.Browse(null, null, "100%", null, null, false, 0, 50).Total == 1, "search with % is literal");
            Ok(s.Browse(null, null, "'s A", null, null, false, 0, 50).Total == 1, "search with apostrophe");
            Ok(s.Browse(null, null, "x_", null, null, false, 0, 50).Total == 0 && s.Browse(null, null, "_x", null, null, false, 0, 50).Total == 1, "search with _ is literal");
            bool threw = false; try { s.InsertFile(new FileRecord { Path = p.ToLowerInvariant(), Status = FileStatus.Pending }); } catch (SqliteException) { threw = true; }
            Ok(threw, "unique path constraint (case-insensitive)");
            var idx = s.Db.Query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'ix_%'").Select(r => r.Str("name")).ToList();
            Ok(idx.Count == 5, "indexes created: " + string.Join(",", idx));
            s.Db.Transaction(() => s.SetMeta("k", "v")); Ok(s.GetMeta("k") == "v", "meta + transaction");
            try { s.Db.Transaction(() => { s.SetMeta("k", "w"); throw new InvalidOperationException("x"); }); } catch (InvalidOperationException) { }
            Ok(s.GetMeta("k") == "v", "transaction rolls back on error");
        }
        Directory.Delete(d, true);
    }

    static void Hashing()
    {
        var d = Tmp(); var f = Path.Combine(d, "abc.txt"); File.WriteAllText(f, "abc");
        var h = Hasher.Hash(f, null, CancellationToken.None);
        Ok(h.Md5 == "900150983CD24FB0D6963F7D28E17F72", "MD5 uppercase hex = Get-FileHash format");
        var big = Path.Combine(d, "big.bin"); var buf = new byte[6 * 1024 * 1024]; new Random(1).NextBytes(buf); File.WriteAllBytes(big, buf);
        var sw = Stopwatch.StartNew(); h = Hasher.Hash(big, new G { BytesPerSecond = 3 * 1024 * 1024 }, CancellationToken.None); sw.Stop();
        Ok(h.Md5 == Convert.ToHexString(MD5.HashData(buf)) && sw.Elapsed.TotalSeconds >= 1.5 && sw.Elapsed.TotalSeconds < 4, $"throttle 3 MB/s on 6 MB took {sw.Elapsed.TotalSeconds:0.0}s");
        var g = new G { PauseReason = "playback" }; var states = new List<string>();
        var t = new Thread(() => { Thread.Sleep(1200); g.PauseReason = null; }); t.Start();
        sw.Restart(); h = Hasher.Hash(big, g, CancellationToken.None, null, w => states.Add(w ?? "go")); sw.Stop();
        Ok(sw.Elapsed.TotalSeconds >= 1 && states.SequenceEqual(new[] { "playback", "go" }) && h.Seconds < sw.Elapsed.TotalSeconds - 0.8, "pause gate waits and resumes; paused time not counted as active");
        var cts = new CancellationTokenSource(300); bool cancelled = false;
        try { Hasher.Hash(big, new G { BytesPerSecond = 1024 * 1024 }, cts.Token); } catch (OperationCanceledException) { cancelled = true; }
        Ok(cancelled, "cancellation stops hashing");
        Directory.Delete(d, true);
    }

    // legacy schema exactly as get-all-hashes.ps1 created it
    static string MakeLegacy(string dir)
    {
        var p = Path.Combine(dir, "filehashes.db");
        using (var db = new SqliteDb(p))
        {
            db.ExecScript(@"CREATE TABLE ""hashes"" (""hash_id"" INTEGER NOT NULL UNIQUE, ""file_id"" INTEGER NOT NULL, ""hash_md5"" TEXT NOT NULL, ""hash_date"" INTEGER NOT NULL, ""file_len"" INTEGER NOT NULL, ""hash_time"" INTEGER, PRIMARY KEY(""hash_id"" AUTOINCREMENT));
                CREATE TABLE ""files"" (""file_id"" INTEGER NOT NULL UNIQUE, ""file_path"" TEXT NOT NULL UNIQUE, ""file_date"" TEXT NOT NULL, ""file_len"" INTEGER NOT NULL, ""file_ext"" TEXT NOT NULL, ""file_hash"" TEXT NOT NULL, PRIMARY KEY(""file_id"" AUTOINCREMENT))");
            void F(long id, string path, string hash) => db.Exec("INSERT INTO files VALUES(@i,@p,'2022-05-29 23:43:57',100,'.mkv',@h)", ("i", id), ("p", path), ("h", hash));
            void H(long fid, string md5, string date) => db.Exec("INSERT INTO hashes(file_id,hash_md5,hash_date,file_len,hash_time) VALUES(@f,@m,@d,100,7)", ("f", fid), ("m", md5), ("d", date));
            F(1, @"M:\MOVIES2\A (2020)\A (2020).mkv", "AAAA0000000000000000000000000001"); H(1, "AAAA0000000000000000000000000001", "2024-01-03 02:10:00"); H(1, "AAAA0000000000000000000000000001", "2026-07-03 03:00:00");
            F(2, @"E:\TELEVISION\Grey's Anatomy\S01E01.mkv", "BBBB0000000000000000000000000002"); // no history: apostrophe bug
            F(3, @"M:\MOVIES2\K (2023)\K.mkv", "CCCC000000000000000000000000000N"); H(3, "CCCC000000000000000000000000000O", "2023-09-03 02:00:00"); H(3, "CCCC000000000000000000000000000N", "2024-01-03 02:00:00"); // baseline updated by user
            F(4, @"M:\MOVIES2\Case\Movie.mkv", "DDDD0000000000000000000000000004"); H(4, "DDDD0000000000000000000000000004", "2025-07-02 02:00:00");
            F(5, @"M:\movies2\case\movie.mkv", "DDDD0000000000000000000000000004"); H(5, "DDDD0000000000000000000000000004", "2026-07-02 02:00:00"); // case duplicate, newer
            F(6, @"E:\MOVIES\Rot\Rot.mkv", "EEEE0000000000000000000000000006"); H(6, "eeee0000000000000000000000000006", "2025-01-02 02:00:00"); H(6, "FFFF0000000000000000000000000006", "2026-07-04 02:00:00"); // still mismatching
        }
        return p;
    }

    static void Import()
    {
        var d = Tmp(); var legacy = MakeLegacy(d);
        var before = File.ReadAllBytes(legacy); var mt = File.GetLastWriteTimeUtc(legacy);
        var tz = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Eastern Standard Time" : "America/New_York");
        using (var s = new IntegrityStore(Path.Combine(d, "store", "integrity.db")))
        {
            var r = LegacyImporter.Import(s, legacy, Path.Combine(d, "tmp"), DateTime.UtcNow, tz);
            Ok(r.Error == null, "import ran " + r.Error);
            Ok(r.SourceFiles == 6 && r.SourceHashes == 8, $"source counts {r.SourceFiles}/{r.SourceHashes}");
            Ok(r.FilesImported == 5 && r.CaseDuplicatesMerged == 1, $"5 files imported, 1 case duplicate merged ({r.FilesImported}/{r.CaseDuplicatesMerged})");
            Ok(r.Ok == 3 && r.Changed == 1 && r.NeverHashed == 1, $"status split ok/changed/never = {r.Ok}/{r.Changed}/{r.NeverHashed}");
            Ok(r.ChecksImported == 8, "all 8 history rows imported (merged row's history attached)");
            var g = s.GetFile(@"E:\TELEVISION\Grey's Anatomy\S01E01.mkv");
            Ok(g?.Status == FileStatus.NeverHashed && g.BaselineMd5 == "BBBB0000000000000000000000000002" && s.History(g.Id).Count == 0, "apostrophe file marked never_hashed, keeps unverified baseline");
            var k = s.GetFile(@"M:\MOVIES2\K (2023)\K.mkv");
            Ok(k.Status == FileStatus.Ok && s.History(k.Id).Count(c => c.Result == CheckResult.LegacyDiffers) == 1, "user-updated baseline: ok now, old mismatch kept in history");
            Ok(r.HistoricMismatches == 2, "historic mismatches counted: " + r.HistoricMismatches);
            var a = s.GetFile(@"M:\MOVIES2\A (2020)\A (2020).mkv");
            Ok(a.LastChecked == new DateTime(2026, 7, 3, 7, 0, 0, DateTimeKind.Utc), "local legacy time converted to UTC (EDT +4): " + a.LastChecked?.ToString("o"));
            Ok(s.History(a.Id).Last().Time == new DateTime(2024, 1, 3, 7, 10, 0, DateTimeKind.Utc), "EST +5 in winter");
            var m = s.GetFile(@"M:\MOVIES2\Case\Movie.mkv");
            Ok(m != null && m.Path == @"M:\movies2\case\movie.mkv" && s.History(m.Id).Count == 2, "case duplicate: newest row wins, both histories kept");
            var rot = s.GetFile(@"E:\MOVIES\Rot\Rot.mkv");
            Ok(rot.Status == FileStatus.Changed && rot.LastMd5 == "FFFF0000000000000000000000000006", "still-mismatching file imported as changed; hashes uppercased");
            var r2 = LegacyImporter.Import(s, legacy, Path.Combine(d, "tmp"), DateTime.UtcNow, tz);
            Ok(r2.FilesImported == 0 && r2.AlreadyPresent == 6 && s.CheckCount == 8, "re-import adds nothing");
        }
        Ok(File.ReadAllBytes(legacy).SequenceEqual(before) && File.GetLastWriteTimeUtc(legacy) == mt, "original legacy DB untouched (bytes + mtime)");
        Ok(!Directory.EnumerateFiles(Path.Combine(d, "tmp")).Any(), "temporary copy deleted");
        Directory.Delete(d, true);
    }

    static void Checks()
    {
        var d = Tmp();
        using (var s = new IntegrityStore(Path.Combine(d, "db", "i.db")))
        {
            var e = new ScanEngine(s) { Options = new ScanOptions { AutoAcceptModifiedExtensions = new[] { ".nfo", "jpg" } } };
            var f = Path.Combine(d, "m", "Movie's (2020).mkv"); Write(f, "original content");
            var o = e.CheckFile(f, "scan", null, null, CancellationToken.None);
            Ok(o.Result == "new" && o.File.Status == FileStatus.Ok && o.File.BaselineMd5 == Md5("original content"), "first hash = baseline (new)");
            o = e.CheckFile(f, "scan", null, null, CancellationToken.None);
            Ok(o.Result == CheckResult.Match, "unchanged file matches");
            // bit rot: same size, same mtime, different bytes
            var mt = File.GetLastWriteTimeUtc(f); File.WriteAllText(f, "origiXal content"); File.SetLastWriteTimeUtc(f, mt);
            o = e.CheckFile(f, "scan", null, null, CancellationToken.None);
            Ok(o.Result == CheckResult.Changed && o.File.Status == FileStatus.Changed && o.File.BaselineMd5 == Md5("original content"), "silent change (same size+time) = changed, baseline kept");
            Ok(s.Problems(false).Count == 1, "shows in Problems");
            Ok(s.AcceptCurrent(o.File.Id, DateTime.UtcNow) && s.GetFile(f).BaselineMd5 == Md5("origiXal content") && s.GetFile(f).Status == FileStatus.Ok, "accept new hash");
            File.WriteAllText(f, "rewritten by an editor, longer"); File.SetLastWriteTimeUtc(f, DateTime.UtcNow.AddMinutes(1));
            o = e.CheckFile(f, "scan", null, null, CancellationToken.None);
            Ok(o.Result == CheckResult.Modified && o.File.Status == FileStatus.Modified, "rewrite (size/time changed) = modified");
            s.SetIgnored(o.File.Id, true); Ok(s.Problems(false).Count == 0 && s.Problems(true).Count == 1, "ignore hides from Problems");
            var nfo = Path.Combine(d, "m", "movie.nfo"); Write(nfo, "<movie/>"); e.CheckFile(nfo, "scan", null, null, CancellationToken.None);
            File.WriteAllText(nfo, "<movie><title>x</title></movie>"); File.SetLastWriteTimeUtc(nfo, DateTime.UtcNow.AddMinutes(1));
            o = e.CheckFile(nfo, "scan", null, null, CancellationToken.None);
            Ok(o.Result == CheckResult.ModifiedAccepted && o.File.Status == FileStatus.Ok, "metadata rewrite auto-accepted (.nfo)");
            var locked = Path.Combine(d, "m", "locked.mkv"); Write(locked, "x");
            if (OperatingSystem.IsWindows())
            {
                using (new FileStream(locked, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                    o = e.CheckFile(locked, "scan", null, null, CancellationToken.None);
                Ok(o.Result == CheckResult.Unreadable && o.File.Status == FileStatus.Unreadable && !string.IsNullOrEmpty(o.File.Error), "locked file = unreadable: " + o.File.Error);
                o = e.CheckFile(locked, "scan", null, null, CancellationToken.None);
                Ok(o.Result == "baseline" || o.Result == "new" || o.Result == CheckResult.Baseline, "readable again -> baseline created: " + o.Result);
            }
            File.Delete(f);
            o = e.CheckFile(f, "recheck", null, null, CancellationToken.None);
            Ok(o.Result == CheckResult.Missing && s.GetFile(f).Status == FileStatus.Missing, "deleted file = missing");
            var hist = s.History(s.GetFile(f).Id).Select(c => c.Result).ToList();
            Ok(string.Join(",", hist) == "missing,modified,accepted,changed,match,baseline", "history: " + string.Join(",", hist));
            Ok(s.DeleteFile(s.GetFile(f).Id) && s.History(o.File.Id).Count == 0, "forget removes record + history (cascade)");
            s.Enqueue(nfo, "added", DateTime.UtcNow.AddMinutes(2), DateTime.UtcNow); s.Enqueue(nfo, "recheck", DateTime.UtcNow, DateTime.UtcNow);
            Ok(s.QueueLength == 1 && s.NextQueued(DateTime.UtcNow)?.Reason == "recheck", "queue de-duplicates by path; earliest time wins");
        }
        Directory.Delete(d, true);
    }

    static void FullScan()
    {
        var d = Tmp(); var r1 = Path.Combine(d, "lib1"); var r2 = Path.Combine(d, "lib2"); var off = Path.Combine(d, "offline");
        for (int i = 0; i < 20; i++) Write(Path.Combine(r1, "Show " + (i % 4) + "'s", "ep" + i.ToString("00") + ".mkv"), "episode " + i + new string('x', 1000 * i));
        Write(Path.Combine(r1, "Thumbs.db"), "junk"); Write(Path.Combine(r1, "a.srt"), "subs");
        Write(Path.Combine(r2, "movie.iso"), "iso");
        using (var s = new IntegrityStore(Path.Combine(d, "db", "i.db")))
        {
            var e = new ScanEngine(s) { Options = new ScanOptions { Exclude = new[] { "Thumbs.db", "*.tmp" } } };
            var roots = new List<ScanRoot> { new ScanRoot(r1, "TV"), new ScanRoot(r2, "Movies"), new ScanRoot(Path.Combine(r1, "Show 1's"), "nested"), new ScanRoot(off, "Offline") };
            // a record under the offline root must not be marked missing
            s.InsertFile(new FileRecord { Path = Path.Combine(off, "old.mkv"), Status = FileStatus.Ok, BaselineMd5 = "00" });
            var p = new ScanProgress(); var pct = new List<double>();
            var res = e.RunFull(roots, null, p, CancellationToken.None, true, x => pct.Add(x));
            var sc = res.Scan; sc = s.GetScan(sc.Id);
            Ok(res.Completed && sc.State == "completed", "scan completed");
            Ok(sc.Total == 22 && sc.New == 22 && sc.Matched == 0, $"all types, exclude glob, nested root once: total {sc.Total} new {sc.New}");
            Ok(res.UnavailableRoots.Count == 1 && s.GetFile(Path.Combine(off, "old.mkv")).Status == FileStatus.Ok && sc.Note.Contains("offline"), "offline root skipped, its files not marked missing");
            Ok(pct.Count > 0 && pct.Last() == 100 && pct.Zip(pct.Skip(1), (a, b) => b >= a).All(x => x), "task progress rises to 100");
            Ok(sc.BytesDone == sc.BytesTotal && sc.BytesTotal > 0, "byte totals");
            // second scan: corrupt one, delete one, add one
            var victim = Path.Combine(r1, "Show 2's", "ep02.mkv"); var mt = File.GetLastWriteTimeUtc(victim); var txt = File.ReadAllText(victim);
            File.WriteAllText(victim, "X" + txt.Substring(1)); File.SetLastWriteTimeUtc(victim, mt);
            File.Delete(Path.Combine(r1, "Show 3's", "ep03.mkv"));
            Write(Path.Combine(r2, "new movie.mkv"), "new");
            res = e.RunFull(roots, null, p, CancellationToken.None);
            sc = s.GetScan(res.Scan.Id);
            Ok(sc.Matched == 20 && sc.Changed == 1 && sc.Missing == 1 && sc.New == 1, $"rescan matched {sc.Matched} changed {sc.Changed} missing {sc.Missing} new {sc.New}");
            Ok(s.ScanFindings(sc.Id).Count == 2, "scan findings (changed + missing)");
            // resume: stop after ~5 files, run again, finishes the rest only
            var cts = new CancellationTokenSource(); int seen = 0;
            var g = new CountingGate(() => { if (++seen == 5) cts.Cancel(); });
            bool stopped = false;
            try { e.RunFull(roots, g, p, cts.Token); } catch (OperationCanceledException) { stopped = true; }
            var part = s.ResumableScan("full");
            Ok(stopped && part != null && part.State == "stopped" && part.Done >= 2 && part.Done < 22 && !string.IsNullOrEmpty(part.Position), $"stop keeps position ({part?.Done} done, at {Path.GetFileName(part?.Position ?? "")})");
            Ok(s.MarkInterrupted() == 0, "stopped scan is not 'running'");
            var doneBefore = part.Done; var checksBefore = s.CheckCount;
            res = e.RunFull(roots, null, p, CancellationToken.None);
            sc = s.GetScan(res.Scan.Id);
            Ok(sc.Id == part.Id && sc.State == "completed" && sc.Total == 22 && sc.Done == 22, "resumed the same scan to completion");
            Ok(s.CheckCount - checksBefore == 22 - doneBefore, $"resume hashed only the remaining {22 - doneBefore} files");
            Ok(sc.Note.Contains("resumed"), "resume noted");
            // fresh start abandons an unfinished scan
            cts = new CancellationTokenSource(); seen = 0; g = new CountingGate(() => { if (++seen == 3) cts.Cancel(); });
            try { e.RunFull(roots, g, p, cts.Token); } catch (OperationCanceledException) { }
            var unfinished = s.ResumableScan("full").Id;
            res = e.RunFull(roots, null, p, CancellationToken.None, resume: false);
            Ok(s.GetScan(unfinished).State == "abandoned" && res.Scan.Id != unfinished && s.GetScan(res.Scan.Id).Done == 22, "start fresh abandons the unfinished scan");
            Ok(p.State == "idle", "progress idle after scan");
        }
        Directory.Delete(d, true);
    }

    sealed class CountingGate : IHashGate
    {
        private readonly Action _onCheck; public CountingGate(Action a) { _onCheck = a; }
        public long BytesPerSecond => 0;
        public string PauseReason { get { _onCheck(); return null; } }
    }

    static void Browse()
    {
        var d = Tmp();
        using (var s = new IntegrityStore(Path.Combine(d, "i.db")))
        {
            for (int i = 0; i < 250; i++) s.InsertFile(new FileRecord { Path = @"M:\MOVIES2\M" + i.ToString("000") + @"\M" + i.ToString("000") + ".mkv", Size = i, Status = i % 50 == 0 ? FileStatus.Changed : FileStatus.Ok });
            s.InsertFile(new FileRecord { Path = @"M:\MOVIES2X\x.mkv", Status = FileStatus.Ok });
            s.InsertFile(new FileRecord { Path = @"E:\TELEVISION\Show\e.mkv", Status = FileStatus.Missing });
            var pg = s.Browse(new[] { @"M:\MOVIES2" }, null, null, null, "size", true, 100, 100);
            Ok(pg.Total == 250 && pg.Items.Count == 100 && pg.Items[0].Size == 149, "prefix group excludes M:\\MOVIES2X; paging + sort desc");
            Ok(s.Browse(new[] { @"m:\movies2\" }, null, null, "problems", null, false, 0, 100).Total == 5, "case-insensitive prefix + problems filter");
            Ok(s.Browse(null, new[] { @"M:\MOVIES2", @"E:\TELEVISION" }, null, null, null, false, 0, 10).Total == 1, "not-in-scope = outside all roots");
            Ok(s.Browse(new[] { @"M:\MOVIES2", @"E:\TELEVISION" }, null, "Show", null, null, false, 0, 10).Total == 1, "multiple roots + search");
            var fs = s.FolderStats(); Ok(fs.Count == 252 && fs.Sum(r => r.Long("problems")) == 6, "folder stats");
        }
        Directory.Delete(d, true);
    }

    static void Manual()
    {
        var d = Tmp();
        var movie = Path.Combine(d, "Movies", "Sintel (2010)");
        var v = Path.Combine(movie, "Sintel (2010).mkv");
        Write(v, new string('a', 3_000_000));
        Write(Path.Combine(movie, "Sintel (2010).nfo"), "<movie/>");
        Write(Path.Combine(movie, "Sintel (2010).en.srt"), "1");
        Write(Path.Combine(movie, "Sintel (2010)-poster.jpg"), "jpg");
        Write(Path.Combine(movie, "Sintel (2010) extras.txt"), "not a companion");
        Write(Path.Combine(movie, "Thumbs.db"), "x");
        var show = Path.Combine(d, "TV", "Show", "Season 01");
        for (int i = 1; i <= 3; i++) Write(Path.Combine(show, "Show - S01E0" + i + ".mkv"), "ep" + i);
        var ex = ScanEngine.GlobsToRegex(new[] { "Thumbs.db" });
        var comp = ManualCheckQueue.Companions(v, ex).Select(Path.GetFileName).OrderBy(x => x).ToList();
        Ok(string.Join("|", comp) == "Sintel (2010)-poster.jpg|Sintel (2010).en.srt|Sintel (2010).nfo", "companions of a movie file: " + string.Join("|", comp));
        using (var s = new IntegrityStore(Path.Combine(d, "m.db")))
        {
            var e = new ScanEngine(s);
            var gone = Path.Combine(d, "TV", "Show", "Season 01", "Show - S01E09.mkv");
            s.InsertFile(new FileRecord { Path = gone, Status = FileStatus.Ok, BaselineMd5 = "AA" });
            s.InsertFile(new FileRecord { Path = Path.Combine(d, "TVX", "other.mkv"), Status = FileStatus.Ok });
            Ok(s.PathsUnder(new[] { Path.Combine(d, "TV") }, null).Count == 1, "PathsUnder prefix (TV, not TVX)");
            Ok(s.PathsUnder(null, new[] { Path.Combine(d, "TV") }).Count == 1, "PathsUnder not-under");
            var item = ManualCheckQueue.ExpandTargets(new[] { v }, null, ex, x => s.PathsUnder(x, null));
            Ok(item.Count == 4, "item targets = file + 3 companions (" + item.Count + ")");
            var folder = ManualCheckQueue.ExpandTargets(null, new[] { Path.Combine(d, "TV", "Show"), show }, ex, x => s.PathsUnder(x, null));
            Ok(folder.Count == 4 && folder.Contains(gone), "series folder: 3 episodes on disk + 1 tracked-but-gone, nested dirs once (" + folder.Count + ")");

            // full scan stuck in pause on another thread; the manual queue still runs
            var paused = new G { PauseReason = "paused" };
            var cts = new CancellationTokenSource();
            var scan = new Thread(() => { try { e.RunFull(new[] { new ScanRoot(Path.Combine(d, "Movies"), "Movies") }, paused, new ScanProgress(), cts.Token); } catch (OperationCanceledException) { } });
            scan.Start(); Thread.Sleep(300);
            var finished = new List<CheckJob>();
            using (var q = new ManualCheckQueue(e, new G()) { JobFinished = j => finished.Add(j) })
            {
                var j1 = q.Enqueue("Sintel (2010)", item);
                var j2 = q.Enqueue("Show", folder);
                Ok(ReferenceEquals(j1, j2) && q.QueuedJobs == 1 && q.PendingFiles == 8, "second batch appended to the active job: one job, 8 files pending");
                Ok(j1.Total == 8 && j1.Batches == 2 && j1.LastBatchAdded == 4 && j1.Label == "Sintel (2010) + 1 more batch", "combined total, batch count and label");
                var j2b = q.Enqueue("Sintel again", item);
                Ok(ReferenceEquals(j1, j2b) && j1.Total == 8 && j1.LastBatchAdded == 0 && j1.Batches == 3, "files already pending are not queued twice");
                Ok(j1.BytesTotal >= 3_000_000, "job byte total from disk");
                q.Drain();
                Ok(j1.State == "done" && j1.Done == 8 && j1.New == 7 && j1.Missing == 1 && j1.Results.Count == 8, "combined job: 7 new + 1 missing, every file has a result");
                Ok(j1.Findings.Count == 1 && j1.Findings[0].Path == gone, "missing file reported");
                var snap = q.Get(j1.Id, 6);
                Ok(snap != null && !ReferenceEquals(snap, j1) && snap.ResultsOffset == 6 && snap.Results.Count == 2, "Get(since) returns a snapshot with newer results only");
                Ok(finished.Count == 1 && !q.Busy, "JobFinished fired; queue idle");
                Ok(scan.IsAlive, "full scan is still paused while manual checks ran");
                var hist = s.History(s.GetFile(v).Id);
                Ok(hist.Count == 1 && hist[0].Source == "manual" && hist[0].ScanId == null, "manual check recorded with source=manual, no scan id");
                File.AppendAllText(v, "x");
                var j3 = q.Enqueue("again", new[] { v }); q.Drain();
                Ok(j3.Modified == 1 && j3.Findings[0].Result == CheckResult.Modified, "re-check detects modification");
                var j4 = q.Enqueue("empty", new string[0]);
                Ok(j4.State == "done" && j4.Total == 0, "empty job finishes immediately");
                var j5 = q.Enqueue("cancel me", item); q.CancelAll(); q.Drain();
                Ok(j5.State == "cancelled" && j5.Done == 0, "cancel drops queued jobs");
                Ok(ManualCheckQueue.Distinct(new[] { "a", "A", " a ", "b", null }).Count == 2, "distinct paths (case-insensitive)");
            }
            cts.Cancel(); scan.Join(5000);
            Ok(!scan.IsAlive, "paused scan stops on cancel");
        }
        Directory.Delete(d, true);
    }

    static void Patcher()
    {
        var html = "<html><body><script src=\"apploader.js\" defer></script></body></html>";
        var a = IndexHtmlPatcher.AddScriptTag(html, "claw-media-integrity.js");
        Ok(a.IndexOf("claw-media-integrity.js") < a.IndexOf("apploader.js"), "script tag before apploader.js");
        Ok(IndexHtmlPatcher.AddScriptTag(a, "claw-media-integrity.js") == a, "idempotent");
        var b = IndexHtmlPatcher.AddScriptTag(a.Replace("apploader.js", "x.js"), "claw-default-chapters.js");
        Ok(b.Contains("claw-media-integrity.js") && b.Contains("claw-default-chapters.js"), "coexists with other plugin tags");
    }

    static void RealDb(string legacy, string verifyDir)
    {
        Console.WriteLine("---- real legacy database: " + legacy);
        var info = new FileInfo(legacy); var size = info.Length; var mt = info.LastWriteTimeUtc;
        string Sha() { using (var fs = new FileStream(legacy, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) return Convert.ToHexString(SHA256.HashData(fs)); }
        var sha = Sha();
        var d = Tmp();
        using (var s = new IntegrityStore(Path.Combine(d, "integrity.db")))
        {
            var r = LegacyImporter.Import(s, legacy, Path.Combine(d, "tmp"), DateTime.UtcNow);
            Console.WriteLine($"  source: {r.SourceFiles} files, {r.SourceHashes} hashes");
            Console.WriteLine($"  imported: {r.FilesImported} files, {r.ChecksImported} checks, {r.CaseDuplicatesMerged} case duplicates merged, {r.AlreadyPresent} already present");
            Console.WriteLine($"  status: ok {r.Ok}, changed {r.Changed}, never hashed {r.NeverHashed}; historic mismatches {r.HistoricMismatches}");
            Console.WriteLine($"  checks span {r.OldestCheck:yyyy-MM-dd HH:mm}Z .. {r.NewestCheck:yyyy-MM-dd HH:mm}Z; took {r.Seconds:0.0}s; error: {r.Error ?? "none"}");
            Ok(r.Error == null && r.FilesImported + r.CaseDuplicatesMerged == r.SourceFiles && r.ChecksImported == r.SourceHashes, "real import: every file and hash accounted for");
            var neverApos = s.Db.ScalarLong("SELECT COUNT(*) FROM files WHERE status='never_hashed' AND path LIKE '%''%'");
            Ok(neverApos == r.NeverHashed, $"all never-hashed files have an apostrophe ({neverApos}/{r.NeverHashed})");
            Ok(s.Db.ScalarLong("SELECT COUNT(*) FROM files WHERE status='never_hashed' AND baseline_md5 IS NOT NULL") == r.NeverHashed, "never-hashed keep the old unverified hash as baseline");
            var dbSize = new FileInfo(Path.Combine(d, "integrity.db")).Length + (File.Exists(Path.Combine(d, "integrity.db-wal")) ? new FileInfo(Path.Combine(d, "integrity.db-wal")).Length : 0);
            Console.WriteLine($"  plugin DB size after import: {dbSize / 1048576.0:0.0} MB");
            var sw = Stopwatch.StartNew(); var pg = s.Browse(new[] { @"E:\TELEVISION" }, null, "'s", "never_hashed", "name", false, 0, 100); sw.Stop();
            Console.WriteLine($"  browse E:\\TELEVISION never-hashed with \"'s\": {pg.Total} rows in {sw.ElapsedMilliseconds} ms");
            sw.Restart(); var fstats = s.FolderStats(); sw.Stop(); Console.WriteLine($"  folder stats: {fstats.Count} folders in {sw.ElapsedMilliseconds} ms");
            if (!string.IsNullOrEmpty(verifyDir) && Directory.Exists(verifyDir))
            {
                // read-only verification of a few real files against the imported baselines
                var e = new ScanEngine(s);
                var res = e.RunFull(new[] { new ScanRoot(verifyDir, "sample") }, null, new ScanProgress(), CancellationToken.None);
                var sc = s.GetScan(res.Scan.Id);
                Console.WriteLine($"  verify {verifyDir}: {sc.Total} files {sc.BytesTotal / 1048576.0:0} MB in {sc.ActiveSeconds:0.0}s: matched {sc.Matched} new {sc.New} changed {sc.Changed} modified {sc.Modified} unreadable {sc.Unreadable}");
                Ok(sc.Changed == 0 && sc.Unreadable == 0 && sc.Matched + sc.New == sc.Total, "real files hash identically to the old script (MD5)");
            }
        }
        Ok(new FileInfo(legacy).Length == size && new FileInfo(legacy).LastWriteTimeUtc == mt && Sha() == sha, "real original unchanged (size, mtime, SHA-256)");
        Directory.Delete(d, true);
    }
}
