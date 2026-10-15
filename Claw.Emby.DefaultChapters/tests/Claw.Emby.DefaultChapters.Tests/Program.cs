using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Claw.Emby.DefaultChapters.Core;
using MediaBrowser.Model.Entities;

namespace Claw.Emby.DefaultChapters.Tests
{
    internal sealed class FakeHost : IChapterHost
    {
        public readonly Dictionary<long, ItemRef> Items = new Dictionary<long, ItemRef>();
        public readonly Dictionary<long, List<ChapterInfo>> Chapters = new Dictionary<long, List<ChapterInfo>>();
        public int SaveCount;

        public IEnumerable<ItemRef> ListMovies(long minRunTimeTicks)
        {
            ListCalls++;
            // Like the Emby query: Movie items, runtime >= threshold; eligibility already applied.
            return Items.Values.Where(i => i.IsMovie && i.RunTimeTicks >= minRunTimeTicks).OrderBy(i => i.InternalId).ToList();
        }

        public int ListCalls;

        public ItemRef FindItem(string id)
        {
            long n;
            return long.TryParse(id, out n) && Items.ContainsKey(n) ? Items[n] : null;
        }

        public List<ChapterInfo> GetChapters(ItemRef item)
        {
            List<ChapterInfo> list;
            return Chapters.TryGetValue(item.InternalId, out list) ? list.Select(Clone).ToList() : new List<ChapterInfo>();
        }

        public void SaveChapters(ItemRef item, List<ChapterInfo> chapters, List<ChapterInfo> previous)
        {
            // Mimic thumbnail-set mode: reuse the shared image of the previous list.
            var shared = ChapterGenerator.SharedImageSource(previous);
            if (shared != null) foreach (var c in chapters) if (string.IsNullOrEmpty(c.ImagePath)) { c.ImagePath = shared.ImagePath; c.ImageDateModified = shared.ImageDateModified; }
            Chapters[item.InternalId] = chapters.Select(Clone).ToList();
            SaveCount++;
        }

        public string GetChapterNameFormat(ItemRef item) { return "Chapter {0}"; }

        public static ChapterInfo Clone(ChapterInfo c)
        {
            return new ChapterInfo { StartPositionTicks = c.StartPositionTicks, Name = c.Name, MarkerType = c.MarkerType, ImagePath = c.ImagePath, ImageDateModified = c.ImageDateModified, ChapterIndex = c.ChapterIndex };
        }
    }

    internal static class Program
    {
        private static int _pass, _fail;
        private static readonly List<string> Failures = new List<string>();

        private static long Min(double m) { return (long)(m * TimeSpan.TicksPerMinute); }

        private static void Check(bool cond, string name)
        {
            if (cond) { _pass++; Console.WriteLine("  ok   " + name); }
            else { _fail++; Failures.Add(name); Console.WriteLine("  FAIL " + name); }
        }

        private static void Throws<T>(Action a, string name) where T : Exception
        {
            try { a(); Check(false, name + " (no exception)"); }
            catch (T) { Check(true, name); }
            catch (Exception ex) { Check(false, name + " (got " + ex.GetType().Name + ")"); }
        }

        private static void Cleanup(string dir) { if (Directory.Exists(dir)) Directory.Delete(dir, true); }

        private static ChapterInfo Ch(double min, string name = null) { return new ChapterInfo { StartPositionTicks = Min(min), Name = name ?? ("Ch " + min), MarkerType = MarkerType.Chapter }; }
        private static ChapterInfo Mk(MarkerType t, double min) { return new ChapterInfo { StartPositionTicks = Min(min), Name = t.ToString(), MarkerType = t }; }

        private static (FakeHost host, DefaultChaptersManager mgr, string dir) Setup(int interval = 5)
        {
            var dir = Path.Combine(Path.GetTempPath(), "dchap-test-" + Guid.NewGuid().ToString("N"));
            var host = new FakeHost();
            var clock = new DateTime(2026, 10, 5, 19, 0, 0, DateTimeKind.Utc);
            var mgr = new DefaultChaptersManager(host, new OverrideStore(Path.Combine(dir, "overrides.json")), () => interval, null, () => clock);
            // 101: movie with 7 irregular real chapters + intro/credits markers, thumbnail-set images
            host.Items[101] = new ItemRef { InternalId = 101, ItemGuid = "aaa", Name = "Heat", Path = @"E:\Movies\Heat (1995)\Heat.mkv", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(170.5), ProductionYear = 1995 };
            var real = new List<ChapterInfo> { Ch(0), Ch(7.2), Ch(21.9), Ch(40.3), Ch(77.7), Ch(120.1), Ch(151.4), Mk(MarkerType.IntroStart, 1.5), Mk(MarkerType.IntroEnd, 3.25), Mk(MarkerType.CreditsStart, 162) };
            foreach (var c in real) { c.ImagePath = @"C:\emby\metadata\thumbnails\heat.bif"; c.ImageDateModified = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero); }
            host.Chapters[101] = real;
            // 102: movie whose chapters are Emby's own 5-minute dummy set
            host.Items[102] = new ItemRef { InternalId = 102, Name = "Alien", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(117) };
            host.Chapters[102] = Enumerable.Range(0, 24).Select(i => Ch(i * 5, "Chapter " + (i + 1))).ToList();
            // 201: an episode, 301: a home video, 401: a movie shorter than one interval
            host.Items[201] = new ItemRef { InternalId = 201, Name = "Pilot", IsMovie = false, TypeName = "Episode", RunTimeTicks = Min(44) };
            host.Chapters[201] = new List<ChapterInfo> { Ch(0), Ch(13) };
            host.Items[301] = new ItemRef { InternalId = 301, Name = "Birthday", IsMovie = false, TypeName = "Video", RunTimeTicks = Min(30) };
            host.Items[401] = new ItemRef { InternalId = 401, Name = "Short", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(3) };
            // Found-movies candidates
            host.Items[501] = new ItemRef { InternalId = 501, Name = "One Chapter", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(95), Path = @"E:\Movies\One\one.mkv" };
            host.Chapters[501] = new List<ChapterInfo> { Ch(0), Mk(MarkerType.IntroStart, 1), Mk(MarkerType.IntroEnd, 2), Mk(MarkerType.CreditsStart, 90) };
            host.Items[502] = new ItemRef { InternalId = 502, Name = "No Chapters", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(61) };
            host.Items[503] = new ItemRef { InternalId = 503, Name = "Exactly Sixty", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(60) };
            host.Chapters[503] = new List<ChapterInfo> { Ch(0) };
            host.Items[504] = new ItemRef { InternalId = 504, Name = "Three", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(130) };
            host.Chapters[504] = new List<ChapterInfo> { Ch(0), Ch(40), Ch(90) };
            host.Items[505] = new ItemRef { InternalId = 505, Name = "Four", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(130) };
            host.Chapters[505] = new List<ChapterInfo> { Ch(0), Ch(40), Ch(90), Ch(100) };
            host.Items[506] = new ItemRef { InternalId = 506, Name = "Two Even", IsMovie = true, TypeName = "Movie", RunTimeTicks = Min(70) };
            host.Chapters[506] = new List<ChapterInfo> { Ch(0), Ch(10) };
            host.Items[507] = new ItemRef { InternalId = 507, Name = "No Runtime", IsMovie = true, TypeName = "Movie", RunTimeTicks = 0 };
            return (host, mgr, dir);
        }

        private static void MasterSwitch()
        {
            Console.WriteLine("Master switch (General tab)");
            var (host, mgr, dir) = Setup();
            try
            {
                var on = true;
                mgr.IsEnabled = () => on;
                mgr.Generate("101", true);
                var item = host.FindItem("101");
                var probed = new List<ChapterInfo> { Ch(0), Ch(30) };
                Check(mgr.ApplyOnRefresh(item, probed) != null, "on: refresh re-applies interval chapters");
                on = false;
                Throws<DefaultChaptersException>(() => mgr.Generate("102", true), "off: Generate refused");
                Throws<DefaultChaptersException>(() => mgr.GenerateMany(new[] { "102" }, true), "off: Generate for many refused");
                try { mgr.Generate("102", true); } catch (DefaultChaptersException ex) { Check(ex.Message.Contains("switched off") && ex.StatusCode == 409, "off: clear message, 409"); }
                Check(mgr.ApplyOnRefresh(item, probed) == null, "off: refresh no longer re-applies overrides");
                Check(mgr.Store.Contains(101), "off: overrides and stash kept");
                mgr.Restore("101");
                Check(!mgr.Store.Contains(101), "off: Revert/Restore still works");
                on = true;
                mgr.Generate("102", true);
                Check(mgr.Store.Contains(102), "on again: Generate works");
            }
            finally { Cleanup(dir); }
        }

        private static void Generator()
        {
            Console.WriteLine("ChapterGenerator");
            var g = ChapterGenerator.Build(Min(125), 5, null, "Chapter {0}");
            Check(g.Count == 25, "125 min @5 -> 25 chapters (0..120)");
            Check(g[0].StartPositionTicks == 0 && g[24].StartPositionTicks == Min(120), "first at 0, last at 120:00");
            Check(g[0].Name == "Chapter 1" && g[24].Name == "Chapter 25", "Emby-style names Chapter 1..25");
            Check(g.Select(c => c.ChapterIndex).SequenceEqual(Enumerable.Range(0, 25)), "ChapterIndex renumbered 0..24");

            var markers = new List<ChapterInfo> { Mk(MarkerType.IntroStart, 1.5), Mk(MarkerType.IntroEnd, 3.25), Mk(MarkerType.CreditsStart, 118), Mk(MarkerType.IntroStart, 1.5 + 0.005), Mk(MarkerType.CreditsStart, 130), Ch(33) };
            var m = ChapterGenerator.Build(Min(125), 5, markers, "Chapter {0}");
            Check(ChapterGenerator.CountChapters(m) == 25, "markers do not change the chapter count");
            Check(m.Count(c => c.MarkerType == MarkerType.IntroStart) == 1, "duplicate IntroStart (within 1s) collapsed");
            Check(m.Any(c => c.MarkerType == MarkerType.IntroEnd && c.StartPositionTicks == Min(3.25)), "IntroEnd kept at 3:15");
            Check(m.Count(c => c.MarkerType == MarkerType.CreditsStart) == 1 && m.Single(c => c.MarkerType == MarkerType.CreditsStart).StartPositionTicks == Min(118), "CreditsStart kept, marker past runtime dropped");
            Check(!m.Any(c => c.MarkerType == MarkerType.Chapter && c.StartPositionTicks == Min(33)), "stray real chapter passed as marker is ignored");
            var order = m.Select(c => c.StartPositionTicks).ToList();
            Check(order.SequenceEqual(order.OrderBy(t => t)), "merged list sorted by position");
            var i0 = m.FindIndex(c => c.MarkerType == MarkerType.IntroStart);
            Check(m[i0 - 1].StartPositionTicks == 0 && m[i0 + 1].MarkerType == MarkerType.IntroEnd && m[i0 + 2].StartPositionTicks == Min(5), "markers sit between Chapter 1 (0:00) and Chapter 2 (5:00)");

            Check(ChapterGenerator.Build(Min(600), 5, null, null).Count == 99, "10 h movie capped at 99 chapters like Emby");
            Check(ChapterGenerator.Build(Min(4.9), 5, null, null) == null, "runtime shorter than interval -> null");
            Check(ChapterGenerator.Build(0, 5, null, null) == null, "unknown runtime -> null");
            Check(ChapterGenerator.Build(Min(30), 0, null, "bad")[1].StartPositionTicks == Min(1), "interval clamped to >=1; bad name format falls back");
            Check(ChapterGenerator.Build(Min(30), 0, null, "bad")[0].Name == "Chapter 1", "fallback name Chapter 1");

            Console.WriteLine("Interval detection");
            Check(ChapterGenerator.DetectIntervalMinutes(g) == 5, "own 5-min set detected as 5");
            Check(ChapterGenerator.DetectIntervalMinutes(m) == 5, "detection ignores markers");
            Check(ChapterGenerator.DetectIntervalMinutes(ChapterGenerator.Build(Min(100), 10, null, null)) == 10, "10-min set detected as 10");
            Check(ChapterGenerator.DetectIntervalMinutes(new[] { Ch(0), Ch(7.2), Ch(21.9) }) == 0, "irregular real chapters -> 0");
            Check(ChapterGenerator.DetectIntervalMinutes(new[] { Ch(0) }) == 0, "single chapter -> 0");
            Check(ChapterGenerator.DetectIntervalMinutes(new[] { Ch(0), Ch(1.5), Ch(3) }) == 0, "90-second steps are not whole minutes -> 0");
            Check(ChapterGenerator.DetectIntervalMinutes(new[] { Ch(0.5), Ch(5.5), Ch(10.5) }) == 0, "first chapter not at 0 -> 0");

            Console.WriteLine("Images");
            var shared = new[] { new ChapterInfo { ImagePath = "x.bif" }, new ChapterInfo { ImagePath = "x.bif" } };
            Check(ChapterGenerator.SharedImageSource(shared) != null, "shared thumbnail-set path detected");
            Check(ChapterGenerator.SharedImageSource(new[] { new ChapterInfo { ImagePath = "a.jpg" }, new ChapterInfo { ImagePath = "b.jpg" } }) == null, "per-chapter images are not reused");
        }

        private static void ManagerGenerate()
        {
            Console.WriteLine("Generate (no confirm needed)");
            var (host, mgr, dir) = Setup();
            var st = mgr.GetStatus("101");
            Check(st.IsMovie && !st.HasOverride && !st.LooksInterval && !st.NeedsConfirm, "status: movie, no override, not interval -> no confirm");
            Check(st.ChapterCount == 7 && st.MarkerCount == 3, "status counts chapters and markers separately");
            var res = mgr.Generate("101", false);
            Check(res.Changed && !res.NeedsConfirm, "generated without confirm");
            var saved = host.Chapters[101];
            Check(ChapterGenerator.CountChapters(saved) == 35, "170.5 min @5 -> 35 chapters");
            Check(saved.Count(ChapterGenerator.IsMarker) == 3, "intro/credits markers preserved");
            Check(saved.All(c => c.ImagePath == @"C:\emby\metadata\thumbnails\heat.bif"), "thumbnail-set image reused for every chapter");
            Check(res.Row.BeforeCount == 7 && res.Row.AfterCount == 35 && res.Row.IntervalMinutes == 5, "row: before 7, after 35, interval 5");
            var rec = mgr.Store.Get(101);
            Check(rec != null && rec.Original.Count == 10 && ChapterGenerator.CountChapters(rec.Original.Select(c => c.ToChapterInfo())) == 7, "stash holds the 7 original chapters + 3 markers");
            Check(rec.Original.All(c => c.ImagePath != null), "stash keeps original image paths");

            var reloaded = new OverrideStore(Path.Combine(dir, "overrides.json"));
            Check(reloaded.Get(101) != null && reloaded.Get(101).Name == "Heat" && reloaded.All().Count == 1, "store survives reload from disk");
            Check(!File.Exists(Path.Combine(dir, "overrides.json.tmp")), "no temp file left after atomic write");

            Throws<DefaultChaptersException>(() => mgr.Generate("401", false), "movie shorter than one interval is refused");
            Throws<DefaultChaptersException>(() => mgr.Generate("999", false), "unknown id -> not found");
            Cleanup(dir);
        }

        private static void ConfirmPath()
        {
            Console.WriteLine("Confirm path");
            var (host, mgr, dir) = Setup();
            var st = mgr.GetStatus("102");
            Check(st.LooksInterval && st.DetectedIntervalMinutes == 5 && st.NeedsConfirm, "Emby dummy 5-min set looks interval -> confirm");
            var before = host.SaveCount;
            var r1 = mgr.Generate("102", false);
            Check(r1.NeedsConfirm && !r1.Changed && host.SaveCount == before && !mgr.Store.Contains(102), "unconfirmed Generate changes nothing");
            Check(r1.ConfirmReason.Contains("5-minute"), "reason names the detected interval");
            var r2 = mgr.Generate("102", true);
            Check(r2.Changed && mgr.Store.Contains(102), "confirmed Generate applies");

            mgr.Generate("101", false);
            var st2 = mgr.GetStatus("101");
            Check(st2.HasOverride && st2.NeedsConfirm, "existing override -> confirm");
            Check(mgr.Generate("101", false).NeedsConfirm, "second unconfirmed Generate is refused");
            var stashBefore = mgr.Store.Get(101).Original.Count;
            mgr.Generate("101", true);
            var rec = mgr.Store.Get(101);
            Check(rec.Original.Count == stashBefore && ChapterGenerator.CountChapters(rec.Original.Select(c => c.ToChapterInfo())) == 7, "re-generate keeps the ORIGINAL stash (not the interval set)");
            Check(rec.BeforeCount == 7, "before count still the original 7");
            Cleanup(dir);
        }

        private static void Restore()
        {
            Console.WriteLine("Restore / revert");
            var (host, mgr, dir) = Setup();
            mgr.Generate("101", false);
            mgr.Generate("102", true);
            Check(mgr.GetRows().Count == 2, "two rows listed");
            // Intro detection runs again after Generate and moves the intro end.
            host.Chapters[101].RemoveAll(c => c.MarkerType == MarkerType.IntroEnd);
            host.Chapters[101].Add(Mk(MarkerType.IntroEnd, 3.5));
            var r = mgr.Restore("101");
            Check(r.Restored && r.Removed && r.ChapterCount == 7, "restore reports 7 chapters");
            var now = host.Chapters[101];
            Check(ChapterGenerator.CountChapters(now) == 7 && now.Where(c => c.MarkerType == MarkerType.Chapter).Select(c => c.StartPositionTicks).SequenceEqual(new[] { Min(0), Min(7.2), Min(21.9), Min(40.3), Min(77.7), Min(120.1), Min(151.4) }), "original chapter positions back");
            Check(now.Any(c => c.MarkerType == MarkerType.IntroEnd && c.StartPositionTicks == Min(3.5)), "current intro marker kept on restore");
            Check(!mgr.Store.Contains(101) && mgr.GetRows().Count == 1 && mgr.GetRows()[0].Id == "102", "revert removed the row");
            Check(new OverrideStore(Path.Combine(dir, "overrides.json")).All().Count == 1, "row removal persisted");
            Throws<DefaultChaptersException>(() => mgr.Restore("101"), "restore without a stash -> not found");

            host.Items.Remove(102);
            var gone = mgr.Restore("102");
            Check(gone.Removed && !gone.Restored && mgr.GetRows().Count == 0, "missing item: row dropped without writing");
            Cleanup(dir);
        }

        private static void Refresh()
        {
            Console.WriteLine("Refresh re-apply");
            var (host, mgr, dir) = Setup();
            var item = host.Items[101];
            Check(mgr.ApplyOnRefresh(item, host.GetChapters(item)) == null, "no override -> refresh untouched");
            mgr.Generate("101", false);
            Check(mgr.ApplyOnRefresh(item, null) == null, "probe did not read chapters -> nothing to do");

            // ffprobe re-reads the file: the 7 embedded chapters come back, without markers.
            var probed = new List<ChapterInfo> { Ch(0), Ch(7.2), Ch(21.9), Ch(40.3), Ch(77.7), Ch(120.1), Ch(151.4) };
            var re = mgr.ApplyOnRefresh(item, probed);
            Check(re != null && ChapterGenerator.CountChapters(re) == 35, "re-applied 35 interval chapters");
            Check(re.Count(ChapterGenerator.IsMarker) == 3 && re.Any(c => c.MarkerType == MarkerType.CreditsStart && c.StartPositionTicks == Min(162)), "markers from the database merged in");
            Check(mgr.Store.Get(101).OriginalUpdatedUtc == null, "same file chapters -> stash untouched");

            // The file was replaced by a cut with different chapters and a shorter runtime.
            item.RunTimeTicks = Min(160);
            var newFile = new List<ChapterInfo> { Ch(0), Ch(12), Ch(50), Ch(99), Mk(MarkerType.CreditsStart, 150) };
            var re2 = mgr.ApplyOnRefresh(item, newFile);
            Check(ChapterGenerator.CountChapters(re2) == 32, "new runtime 160 min -> 32 chapters");
            var rec = mgr.Store.Get(101);
            Check(rec.OriginalUpdatedUtc != null && ChapterGenerator.CountChapters(rec.Original.Select(c => c.ToChapterInfo())) == 4 && rec.BeforeCount == 4, "different file chapters become the new stash");
            Check(rec.AfterCount == 32, "after count updated");
            Check(re2.Count(c => c.MarkerType == MarkerType.CreditsStart) == 1 && re2.Single(c => c.MarkerType == MarkerType.CreditsStart).StartPositionTicks == Min(150), "probe's CreditsStart wins over the stale database one");
            Check(re2.Any(c => c.MarkerType == MarkerType.IntroStart) && re2.Any(c => c.MarkerType == MarkerType.IntroEnd), "database intro markers fill types the probe lacks");

            // Probe returns our own interval set (e.g. a re-read of chapters we wrote) -> stash unchanged.
            var stamp = rec.OriginalUpdatedUtc;
            mgr.ApplyOnRefresh(item, re2.Select(FakeHost.Clone).ToList());
            Check(mgr.Store.Get(101).OriginalUpdatedUtc == stamp && mgr.Store.Get(101).BeforeCount == 4, "own interval set is never stashed as original");

            item.RunTimeTicks = Min(2);
            Check(mgr.ApplyOnRefresh(item, newFile) == null, "runtime shorter than interval -> Emby's chapters left alone");
            Cleanup(dir);
        }

        private static void NonMovies()
        {
            Console.WriteLine("Non-movies skipped");
            var (host, mgr, dir) = Setup();
            var st = mgr.GetStatus("201");
            Check(!st.IsMovie && !st.NeedsConfirm && st.ChapterCount == 0, "episode status: not a movie, no chapter lookup");
            Throws<DefaultChaptersException>(() => mgr.Generate("201", true), "Generate on an episode is refused");
            Throws<DefaultChaptersException>(() => mgr.Generate("301", true), "Generate on a home video is refused");
            Check(host.Chapters[201].Count == 2 && !mgr.Store.Contains(201), "episode chapters untouched, no row");
            Check(mgr.ApplyOnRefresh(host.Items[201], new List<ChapterInfo> { Ch(0) }) == null, "refresh hook ignores non-movies");
            Cleanup(dir);
        }

        private static void Found()
        {
            Console.WriteLine("Found movies scan");
            var (host, mgr, dir) = Setup();
            var res = mgr.Find(new FindCriteria { MinRuntimeMinutes = 60, MaxChapters = 3, ExcludeOverridden = true });
            var ids = res.Items.Select(i => i.Id).ToList();
            Check(ids.SequenceEqual(new[] { "502", "501", "504", "506" }), "default criteria: >60 min and <=3 chapters, sorted by name (got " + string.Join(",", ids) + ")");
            Check(!ids.Contains("503"), "exactly 60:00 is not longer than 60 min");
            Check(!ids.Contains("505") && !ids.Contains("101") && !ids.Contains("102"), "movies with more than 3 chapters excluded");
            Check(!ids.Contains("201") && !ids.Contains("301"), "episode and home video never listed");
            Check(!ids.Contains("507") && !ids.Contains("401"), "unknown or short runtime not listed");
            var one = res.Items.Single(i => i.Id == "501");
            Check(one.ChapterCount == 1 && one.MarkerCount == 3, "markers are not counted as chapters");
            Check(one.RunTimeTicks == Min(95) && one.Path == @"E:\Movies\One\one.mkv" && one.CanGenerate && !one.NeedsConfirm, "row carries runtime, path, can-generate, no confirm");
            var even = res.Items.Single(i => i.Id == "506");
            Check(even.LooksInterval && even.NeedsConfirm && even.DetectedIntervalMinutes == 10, "evenly spaced 2-chapter movie flagged as needing confirm");
            Check(res.MatchCount == 4 && res.ScannedCount == 7 && !res.Truncated && res.IntervalMinutes == 5, "counts: 4 matches of 7 movies longer than 60 min");
            Check(host.SaveCount == 0 && mgr.GetRows().Count == 0, "scan is read-only");

            var hour2 = mgr.Find(new FindCriteria { MinRuntimeMinutes = 120, MaxChapters = 0 });
            Check(hour2.Items.Count == 0, ">120 min with 0 chapters: none");
            var any = mgr.Find(new FindCriteria { MinRuntimeMinutes = 0, MaxChapters = 999 });
            Check(any.Items.Count == 9 && !any.Items.Any(i => i.Id == "507") && any.Items.Any(i => i.Id == "401" && !i.CanGenerate), "wide criteria list every movie with a runtime; short one marked can't-generate");
            var clamp = mgr.Find(new FindCriteria { MinRuntimeMinutes = -5, MaxChapters = -1 });
            Check(clamp.Criteria.MinRuntimeMinutes == 0 && clamp.Criteria.MaxChapters == 0, "criteria clamped to >= 0");

            Console.WriteLine("Bulk generate");
            var bulk = mgr.GenerateMany(new[] { "501", "502", " 501 ", "201", "999", "506" }, false);
            Check(bulk.Results.Count == 5, "duplicate ids collapsed");
            Check(bulk.ChangedCount == 2 && bulk.Results.Single(r => r.Id == "501").Changed && bulk.Results.Single(r => r.Id == "502").Changed, "two eligible movies generated");
            Check(bulk.Results.Single(r => r.Id == "201").Error.Contains("only available for movies"), "episode refused with a message, rest continue");
            Check(bulk.Results.Single(r => r.Id == "999").Error == "Item not found.", "unknown id reported");
            Check(bulk.Results.Single(r => r.Id == "506").NeedsConfirm && bulk.NeedsConfirmCount == 1 && !mgr.Store.Contains(506), "unconfirmed bulk skips interval-looking movie");
            Check(bulk.FailedCount == 2, "failed count 2");
            Check(ChapterGenerator.CountChapters(host.Chapters[501]) == 19 && host.Chapters[501].Count(ChapterGenerator.IsMarker) == 3, "95 min -> 19 chapters, markers kept");
            Check(ChapterGenerator.CountChapters(mgr.Store.Get(501).Original.Select(c => c.ToChapterInfo())) == 1, "original single chapter stashed");
            Check(mgr.GetRows().Select(r => r.Id).OrderBy(x => x).SequenceEqual(new[] { "501", "502" }), "generated movies appear in the Changed list");
            var bulk2 = mgr.GenerateMany(new[] { "506" }, true);
            Check(bulk2.ChangedCount == 1 && mgr.Store.Contains(506), "confirmed bulk replaces the interval-looking set");

            var after = mgr.Find(new FindCriteria { MinRuntimeMinutes = 60, MaxChapters = 3, ExcludeOverridden = true });
            Check(after.Items.Select(i => i.Id).SequenceEqual(new[] { "504" }), "overridden movies leave the Found list");
            var incl = mgr.Find(new FindCriteria { MinRuntimeMinutes = 60, MaxChapters = 99, ExcludeOverridden = false });
            var r501 = incl.Items.Single(i => i.Id == "501");
            Check(r501.HasOverride && r501.NeedsConfirm, "with exclude off, overridden movies show as needing confirm");

            mgr.Restore("501");
            Check(mgr.Find(new FindCriteria()).Items.Any(i => i.Id == "501"), "after revert the movie is found again");

            Throws<DefaultChaptersException>(() => mgr.GenerateMany(new string[0], true), "empty selection refused");
            Throws<DefaultChaptersException>(() => mgr.GenerateMany(Enumerable.Range(1, 201).Select(i => i.ToString()), true), "more than 200 ids refused");
            Cleanup(dir);
        }

        private static void Inject()
        {
            Console.WriteLine("index.html patch");
            const string F = "claw-default-chapters.js";
            var html = "<html><body>\n    <script src=\"claw-custom-item-ui.js\" defer></script>\n    <script src=\"apploader.js\" defer></script>\n</body></html>";
            var once = IndexHtmlPatcher.AddScriptTag(html, F);
            Check(once.Contains("claw-default-chapters.js") && once.IndexOf("claw-default-chapters.js") < once.IndexOf("apploader.js"), "tag added before apploader.js");
            Check(once.Contains("claw-custom-item-ui.js"), "other plugin's tag left in place");
            Check(IndexHtmlPatcher.AddScriptTag(once, F) == once, "idempotent");
            Check(IndexHtmlPatcher.AddScriptTag("<html><body></body></html>", F).Contains("claw-default-chapters.js\" defer></script>\n</body>"), "falls back to before </body>");
        }

        private static int Main()
        {
            return RunAll();
        }

        private static int RunAll()
        {
            Generator();
            ManagerGenerate();
            ConfirmPath();
            Restore();
            Refresh();
            NonMovies();
            Found();
            Inject();
            MasterSwitch();
            Console.WriteLine();
            Console.WriteLine("Passed " + _pass + ", failed " + _fail);
            foreach (var f in Failures) Console.WriteLine("  failed: " + f);
            return _fail == 0 ? 0 : 1;
        }
    }
}
