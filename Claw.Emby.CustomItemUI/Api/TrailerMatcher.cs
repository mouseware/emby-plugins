using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Claw.Emby.CustomItemUI.Api
{
    /// <summary>A library movie or series the user owns, used as a swap target for its trailer.</summary>
    public sealed class OwnedTitle
    {
        public string Id { get; set; }
        public string Name { get; set; }
        /// <summary>Movie or Series.</summary>
        public string Type { get; set; }
        public int? Year { get; set; }
        public string Imdb { get; set; }
        public string Tmdb { get; set; }
        public string ImageTag { get; set; }
        public string ServerId { get; set; }
        public double? PrimaryImageAspectRatio { get; set; }
    }

    public sealed class TrailerInfo
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public int? Year { get; set; }
        public string Imdb { get; set; }
        public string Tmdb { get; set; }
        /// <summary>True when this trailer is a local extra of a library movie or series (not swapped: it already belongs to that item).</summary>
        public bool IsLibraryExtra { get; set; }
    }

    public sealed class TrailerMatch
    {
        public string TrailerId { get; set; }
        public OwnedTitle Owned { get; set; }
        /// <summary>imdb | tmdb | title-year</summary>
        public string How { get; set; }
    }

    /// <summary>
    /// Matches a trailer to a library movie or series. Provider IDs (IMDb, then TMDb) first, then a normalized title + year.
    /// Pure; unit-tested without Emby types.
    /// </summary>
    public sealed class TrailerIndex
    {
        private readonly Dictionary<string, OwnedTitle> _imdb = new Dictionary<string, OwnedTitle>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, OwnedTitle> _tmdbMovie = new Dictionary<string, OwnedTitle>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, OwnedTitle> _tmdbSeries = new Dictionary<string, OwnedTitle>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, OwnedTitle> _title = new Dictionary<string, OwnedTitle>(StringComparer.OrdinalIgnoreCase);
        public int OwnedCount { get; private set; }

        public static TrailerIndex Build(IEnumerable<OwnedTitle> owned)
        {
            var ix = new TrailerIndex();
            foreach (var o in owned ?? Array.Empty<OwnedTitle>())
            {
                if (o == null || string.IsNullOrEmpty(o.Id)) continue;
                ix.OwnedCount++;
                bool series = string.Equals(o.Type, "Series", StringComparison.OrdinalIgnoreCase);
                var imdb = NormId(o.Imdb);
                if (imdb != null && !ix._imdb.ContainsKey(imdb)) ix._imdb[imdb] = o;
                var tmdb = NormId(o.Tmdb);
                if (tmdb != null)
                {
                    var d = series ? ix._tmdbSeries : ix._tmdbMovie;
                    if (!d.ContainsKey(tmdb)) d[tmdb] = o;
                }
                var key = TitleYear(o.Name, o.Year);
                if (key != null && !ix._title.ContainsKey(key)) ix._title[key] = o;
            }
            return ix;
        }

        /// <summary>Null when the trailer is a library extra or no owned title matches.</summary>
        public TrailerMatch Match(TrailerInfo t)
        {
            if (t == null || t.IsLibraryExtra || string.IsNullOrEmpty(t.Id)) return null;
            var imdb = NormId(t.Imdb);
            if (imdb != null && _imdb.TryGetValue(imdb, out var o)) return Hit(t, o, "imdb");
            var tmdb = NormId(t.Tmdb);
            if (tmdb != null)
            {
                if (_tmdbMovie.TryGetValue(tmdb, out o)) return Hit(t, o, "tmdb");
                if (_tmdbSeries.TryGetValue(tmdb, out o)) return Hit(t, o, "tmdb");
            }
            var key = TitleYear(t.Name, t.Year);
            if (key != null && _title.TryGetValue(key, out o)) return Hit(t, o, "title-year");
            return null;
        }

        public int CountMatches(IEnumerable<TrailerInfo> trailers, out int considered, out int extras, out int imdb, out int tmdb, out int title)
        {
            considered = extras = imdb = tmdb = title = 0;
            int n = 0;
            foreach (var t in trailers ?? Array.Empty<TrailerInfo>())
            {
                if (t == null) continue;
                if (t.IsLibraryExtra) { extras++; continue; }
                considered++;
                var m = Match(t);
                if (m == null) continue;
                n++;
                if (m.How == "imdb") imdb++;
                else if (m.How == "tmdb") tmdb++;
                else title++;
            }
            return n;
        }

        private static TrailerMatch Hit(TrailerInfo t, OwnedTitle o, string how) =>
            new TrailerMatch { TrailerId = t.Id, Owned = o, How = how };

        public static string NormId(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            s = s.Trim();
            return s.Length == 0 ? null : s;
        }

        /// <summary>Lower-case letters and digits only, leading "the " moved to the end, trailing (year) stripped.</summary>
        public static string NormTitle(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            var s = name.Trim().ToLowerInvariant();
            s = Regex.Replace(s, @"\s*\(\d{4}\)\s*$", "");
            s = Regex.Replace(s, @"[^a-z0-9]+", " ");
            s = Regex.Replace(s, @"\s+", " ").Trim();
            if (s.StartsWith("the ", StringComparison.Ordinal) && s.Length > 4) s = s.Substring(4).Trim();
            if (s.EndsWith(" the", StringComparison.Ordinal) && s.Length > 4) s = s.Substring(0, s.Length - 4).Trim();
            return s.Length == 0 ? null : s;
        }

        public static string TitleYear(string name, int? year)
        {
            var n = NormTitle(name);
            return n == null ? null : n + "|" + (year.HasValue && year.Value > 0 ? year.Value.ToString() : "");
        }
    }
}
