using System;
using System.Collections.Generic;
using System.Linq;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Services;

namespace Claw.Emby.CustomItemUI.Api
{
    [Route("/ClawCustomItemUI/TrailerMap", "GET", Summary = "Custom Item UI: library movies/shows for the given trailer item ids (swap map, cached)")]
    [Authenticated]
    public class GetTrailerMap : IReturn<TrailerMapResult>
    {
        /// <summary>Comma-separated trailer item ids (GUID).</summary>
        public string Ids { get; set; }
    }

    [Route("/ClawCustomItemUI/TrailerStats", "GET", Summary = "Custom Item UI: how many Trailers-channel items would be replaced with a library movie or show (read-only)")]
    [Authenticated(Roles = "Admin")]
    public class GetTrailerStats : IReturn<TrailerStats> { }

    public class TrailerMapResult { public List<TrailerSwapDto> Items { get; set; } = new List<TrailerSwapDto>(); }

    public class TrailerSwapDto
    {
        public string TrailerId { get; set; }
        public string Id { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public int? Year { get; set; }
        public string ImageTag { get; set; }
        public string ServerId { get; set; }
        public double? PrimaryImageAspectRatio { get; set; }
        public string Match { get; set; }
    }

    public class TrailerStats
    {
        public int Trailers { get; set; }
        public int ChannelTrailers { get; set; }
        public int LibraryExtras { get; set; }
        public int Swapped { get; set; }
        public int ByImdb { get; set; }
        public int ByTmdb { get; set; }
        public int ByTitleYear { get; set; }
        public int Unchanged { get; set; }
        public int OwnedMovies { get; set; }
        public int OwnedSeries { get; set; }
    }

    /// <summary>
    /// Server-side lookup for "Replace trailers of movies I own". One call maps many trailer ids to the
    /// owned movie or series (IMDb / TMDb, then title+year). Local extras of a library item are never mapped.
    /// The index is cached briefly so home rows and the Trailers channel don't repeat a full library walk.
    /// </summary>
    public class TrailerService : IService
    {
        public ILibraryManager Library { get; set; }
        public IAuthorizationContext Auth { get; set; }
        public IRequest Request { get; set; }
        public IDtoService Dto { get; set; }

        private static readonly object CacheLock = new object();
        private static TrailerIndex _index;
        private static Dictionary<string, TrailerInfo> _trailers;
        private static TrailerStats _stats;
        private static DateTime _builtUtc = DateTime.MinValue;
        private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

        public object Get(GetTrailerMap r)
        {
            var ids = (r.Ids ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).Where(s => s.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(200).ToList();
            var res = new TrailerMapResult();
            if (ids.Count == 0 || Library == null) return res;
            var (ix, trailers, _) = Snapshot();
            User user = null;
            try { user = Auth != null && Request != null ? Auth.GetAuthorizationInfo(Request)?.User : null; } catch { }
            foreach (var id in ids)
            {
                var key = Key(id);
                if (!trailers.TryGetValue(key, out var t) && !trailers.TryGetValue(id, out t))
                    t = Describe(Library.GetItemById(ParseId(id)), null);
                var m = ix.Match(t);
                if (m?.Owned == null) continue;
                res.Items.Add(ToSwap(m, id, user));
            }
            return res;
        }

        public object Get(GetTrailerStats r)
        {
            var (_, _, stats) = Snapshot();
            return stats;
        }

        private (TrailerIndex, Dictionary<string, TrailerInfo>, TrailerStats) Snapshot()
        {
            lock (CacheLock)
            {
                if (_index != null && DateTime.UtcNow - _builtUtc < Ttl) return (_index, _trailers, _stats);
                Rebuild();
                return (_index, _trailers, _stats);
            }
        }

        private void Rebuild()
        {
            var movies = Library.GetItemList(new InternalItemsQuery { IncludeItemTypes = new[] { "Movie" }, Recursive = true }) ?? Array.Empty<BaseItem>();
            var series = Library.GetItemList(new InternalItemsQuery { IncludeItemTypes = new[] { "Series" }, Recursive = true }) ?? Array.Empty<BaseItem>();
            var owned = new List<OwnedTitle>(movies.Length + series.Length);
            foreach (var it in movies) { var o = ToOwned(it, "Movie"); if (o != null) owned.Add(o); }
            foreach (var it in series) { var o = ToOwned(it, "Series"); if (o != null) owned.Add(o); }
            var ix = TrailerIndex.Build(owned);

            var raw = Library.GetItemList(new InternalItemsQuery { IncludeItemTypes = new[] { "Trailer" }, Recursive = true }) ?? Array.Empty<BaseItem>();
            var map = new Dictionary<string, TrailerInfo>(raw.Length, StringComparer.OrdinalIgnoreCase);
            var list = new List<TrailerInfo>(raw.Length);
            foreach (var it in raw)
            {
                var t = Describe(it, ParentType(it));
                if (t == null) continue;
                map[Key(t.Id)] = t;
                list.Add(t);
            }
            var swapped = ix.CountMatches(list, out var considered, out var extras, out var imdb, out var tmdb, out var title);
            _index = ix;
            _trailers = map;
            _stats = new TrailerStats
            {
                Trailers = list.Count, ChannelTrailers = considered, LibraryExtras = extras,
                Swapped = swapped, ByImdb = imdb, ByTmdb = tmdb, ByTitleYear = title,
                Unchanged = considered - swapped,
                OwnedMovies = movies.Length, OwnedSeries = series.Length
            };
            _builtUtc = DateTime.UtcNow;
        }

        private static OwnedTitle ToOwned(BaseItem it, string type)
        {
            if (it == null) return null;
            int? year = it.ProductionYear > 0 ? it.ProductionYear : (int?)null;
            return new OwnedTitle
            {
                Id = it.Id.ToString("D"),
                Name = it.Name,
                Type = type,
                Year = year,
                Imdb = it.GetProviderId(MetadataProviders.Imdb) ?? it.GetProviderId("Imdb"),
                Tmdb = it.GetProviderId(MetadataProviders.Tmdb) ?? it.GetProviderId("Tmdb")
            };
        }

        private static TrailerInfo Describe(BaseItem it, string parentType)
        {
            if (it == null) return null;
            if (parentType == null) parentType = ParentType(it);
            bool extra = string.Equals(parentType, "Movie", StringComparison.OrdinalIgnoreCase)
                      || string.Equals(parentType, "Series", StringComparison.OrdinalIgnoreCase);
            return new TrailerInfo
            {
                Id = it.Id.ToString("D"),
                Name = it.Name,
                Year = it.ProductionYear > 0 ? it.ProductionYear : (int?)null,
                Imdb = it.GetProviderId(MetadataProviders.Imdb) ?? it.GetProviderId("Imdb"),
                Tmdb = it.GetProviderId(MetadataProviders.Tmdb) ?? it.GetProviderId("Tmdb"),
                IsLibraryExtra = extra
            };
        }

        private static string ParentType(BaseItem it)
        {
            try
            {
                var p = it.GetParent();
                return p?.GetClientTypeName() ?? p?.GetType().Name;
            }
            catch { return null; }
        }

        private TrailerSwapDto ToSwap(TrailerMatch m, string trailerId, User user)
        {
            var o = m.Owned;
            string tag = o.ImageTag, server = o.ServerId;
            double? aspect = o.PrimaryImageAspectRatio;
            try
            {
                var item = Library.GetItemById(ParseId(o.Id));
                if (item != null && Dto != null)
                {
                    var dto = Dto.GetBaseItemDto(item, new DtoOptions(false), user);
                    if (dto != null)
                    {
                        if (dto.ImageTags != null && dto.ImageTags.TryGetValue(ImageType.Primary, out var t) && !string.IsNullOrEmpty(t)) tag = t;
                        if (!string.IsNullOrEmpty(dto.ServerId)) server = dto.ServerId;
                        if (dto.PrimaryImageAspectRatio != null) aspect = dto.PrimaryImageAspectRatio;
                    }
                }
            }
            catch { }
            return new TrailerSwapDto
            {
                TrailerId = trailerId, Id = o.Id, Name = o.Name, Type = o.Type, Year = o.Year,
                ImageTag = tag, ServerId = server, PrimaryImageAspectRatio = aspect, Match = m.How
            };
        }

        private static string Key(string id)
        {
            var g = ParseId(id);
            return g == Guid.Empty ? (id ?? "") : g.ToString("D");
        }

        private static Guid ParseId(string s)
        {
            if (Guid.TryParse(s, out var g)) return g;
            return Guid.Empty;
        }
    }
}
