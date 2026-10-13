using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using MediaBrowser.Model.Entities;

namespace Claw.Emby.DefaultChapters.Core
{
    /// <summary>
    /// Pure chapter math: no Emby services, no I/O. Everything here is covered by the offline tests.
    /// </summary>
    public static class ChapterGenerator
    {
        /// <summary>Same ceiling Emby uses for its own auto-generated chapters.</summary>
        public const int MaxChapters = 99;

        /// <summary>Two positions closer than this are treated as the same point (1 second).</summary>
        public const long SameSpotTicks = TimeSpan.TicksPerSecond;

        public const string DefaultNameFormat = "Chapter {0}";

        public static int ClampInterval(int minutes)
        {
            if (minutes < 1) return 1;
            if (minutes > 60) return 60;
            return minutes;
        }

        public static bool IsMarker(ChapterInfo c)
        {
            return c != null && c.MarkerType != MarkerType.Chapter;
        }

        /// <summary>
        /// Builds interval chapters (0, n, 2n ... &lt; runtime) and merges the given intro/credits markers
        /// back in by position. Returns null when the runtime is unknown or shorter than one interval,
        /// which mirrors Emby's own rule for dummy chapters.
        /// </summary>
        public static List<ChapterInfo> Build(long runTimeTicks, int intervalMinutes, IEnumerable<ChapterInfo> markers, string nameFormat)
        {
            var step = TimeSpan.FromMinutes(ClampInterval(intervalMinutes)).Ticks;
            if (runTimeTicks <= 0 || runTimeTicks < step)
            {
                return null;
            }

            if (string.IsNullOrWhiteSpace(nameFormat) || nameFormat.IndexOf("{0}", StringComparison.Ordinal) < 0)
            {
                nameFormat = DefaultNameFormat;
            }

            var list = new List<ChapterInfo>();
            var number = 1;
            for (long pos = 0; pos < runTimeTicks && number <= MaxChapters; pos += step, number++)
            {
                list.Add(new ChapterInfo
                {
                    StartPositionTicks = pos,
                    MarkerType = MarkerType.Chapter,
                    Name = string.Format(CultureInfo.InvariantCulture, nameFormat, number.ToString(CultureInfo.InvariantCulture))
                });
            }

            list.AddRange(CleanMarkers(markers, runTimeTicks));
            return Order(list);
        }

        /// <summary>
        /// Keeps only real markers inside the runtime, one per type and position (first name wins).
        /// </summary>
        public static List<ChapterInfo> CleanMarkers(IEnumerable<ChapterInfo> markers, long runTimeTicks)
        {
            var kept = new List<ChapterInfo>();
            if (markers == null) return kept;

            foreach (var m in markers)
            {
                if (!IsMarker(m)) continue;
                if (m.StartPositionTicks < 0) continue;
                if (runTimeTicks > 0 && m.StartPositionTicks > runTimeTicks) continue;
                var dup = kept.Any(k => k.MarkerType == m.MarkerType &&
                                        Math.Abs(k.StartPositionTicks - m.StartPositionTicks) < SameSpotTicks);
                if (dup) continue;
                kept.Add(new ChapterInfo
                {
                    StartPositionTicks = m.StartPositionTicks,
                    MarkerType = m.MarkerType,
                    Name = m.Name
                });
            }
            return kept;
        }

        /// <summary>
        /// Merges two marker sources (e.g. the fresh probe and the database). For each marker type the
        /// first source wins when it has one; the second source only fills in types the first lacks.
        /// This avoids two different CreditsStart positions after a file was replaced.
        /// </summary>
        public static List<ChapterInfo> MergeMarkers(IEnumerable<ChapterInfo> first, IEnumerable<ChapterInfo> second, long runTimeTicks)
        {
            var primary = CleanMarkers(first, runTimeTicks);
            var present = new HashSet<MarkerType>(primary.Select(m => m.MarkerType));
            var all = new List<ChapterInfo>(primary);
            all.AddRange(CleanMarkers(second, runTimeTicks).Where(m => !present.Contains(m.MarkerType)));
            return all;
        }

        /// <summary>Sorts by position (chapters before markers on a tie) and renumbers ChapterIndex.</summary>
        public static List<ChapterInfo> Order(IEnumerable<ChapterInfo> chapters)
        {
            var ordered = chapters
                .Select((c, i) => new { c, i })
                .OrderBy(x => x.c.StartPositionTicks)
                .ThenBy(x => x.c.MarkerType == MarkerType.Chapter ? 0 : 1)
                .ThenBy(x => x.i)
                .Select(x => x.c)
                .ToList();
            for (var i = 0; i < ordered.Count; i++)
            {
                ordered[i].ChapterIndex = i;
            }
            return ordered;
        }

        public static int CountChapters(IEnumerable<ChapterInfo> chapters)
        {
            return chapters == null ? 0 : chapters.Count(c => c != null && c.MarkerType == MarkerType.Chapter);
        }

        /// <summary>
        /// Returns the step in whole minutes when the chapter-type entries look like an evenly spaced
        /// set (at least 2, first at 0, every gap identical and a whole number of minutes); otherwise 0.
        /// </summary>
        public static int DetectIntervalMinutes(IEnumerable<ChapterInfo> chapters)
        {
            if (chapters == null) return 0;
            var starts = chapters.Where(c => c != null && c.MarkerType == MarkerType.Chapter)
                                 .Select(c => c.StartPositionTicks)
                                 .OrderBy(t => t)
                                 .ToList();
            if (starts.Count < 2) return 0;
            if (Math.Abs(starts[0]) >= SameSpotTicks) return 0;

            var step = starts[1] - starts[0];
            if (step < TimeSpan.TicksPerMinute - SameSpotTicks) return 0;
            for (var i = 2; i < starts.Count; i++)
            {
                if (Math.Abs((starts[i] - starts[i - 1]) - step) >= SameSpotTicks) return 0;
            }

            var minutes = (long)Math.Round(step / (double)TimeSpan.TicksPerMinute);
            if (Math.Abs(step - minutes * TimeSpan.TicksPerMinute) >= SameSpotTicks) return 0;
            return (int)minutes;
        }

        public static bool LooksLikeIntervalSet(IEnumerable<ChapterInfo> chapters)
        {
            return DetectIntervalMinutes(chapters) > 0;
        }

        /// <summary>True when both lists have the same chapter-type positions (within a second).</summary>
        public static bool SameChapterPositions(IEnumerable<ChapterInfo> a, IEnumerable<ChapterInfo> b)
        {
            var x = (a ?? Enumerable.Empty<ChapterInfo>()).Where(c => c != null && c.MarkerType == MarkerType.Chapter).Select(c => c.StartPositionTicks).OrderBy(t => t).ToList();
            var y = (b ?? Enumerable.Empty<ChapterInfo>()).Where(c => c != null && c.MarkerType == MarkerType.Chapter).Select(c => c.StartPositionTicks).OrderBy(t => t).ToList();
            if (x.Count != y.Count) return false;
            for (var i = 0; i < x.Count; i++)
            {
                if (Math.Abs(x[i] - y[i]) >= SameSpotTicks) return false;
            }
            return true;
        }

        /// <summary>
        /// When every existing chapter that has an image points at one shared file (Emby's thumbnail-set
        /// mode), returns that path and date so new chapters can reuse it. Otherwise null.
        /// </summary>
        public static ChapterInfo SharedImageSource(IEnumerable<ChapterInfo> chapters)
        {
            if (chapters == null) return null;
            var withImage = chapters.Where(c => c != null && !string.IsNullOrEmpty(c.ImagePath)).ToList();
            if (withImage.Count == 0) return null;
            var path = withImage[0].ImagePath;
            if (withImage.Any(c => !string.Equals(c.ImagePath, path, StringComparison.OrdinalIgnoreCase))) return null;
            if (withImage.Count == 1 && chapters.Count(c => c != null) > 1) return null;
            return withImage[0];
        }
    }
}
