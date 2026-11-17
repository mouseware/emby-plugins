using System;
using System.Collections.Generic;
using System.Text.Json;
using Claw.Emby.SeerrRequests.Core;

namespace Claw.Emby.SeerrRequests.Tests
{
    /// <summary>In-memory Seerr stand-in with made-up titles and users. Records headers without exposing them.</summary>
    public class MockSeerr : ISeerrTransport
    {
        public const string FakeKey = "test-seerr-key-FAKESECRET_e1f2g3h4i5j6k7l8m9n0";
        public string LastMethod { get; private set; }
        public string LastUrl { get; private set; }
        public string LastBody { get; private set; }
        public bool LastSentKey { get; private set; }
        public string LastUser { get; private set; }
        public int LastKeyLength { get; private set; }
        public List<string> Calls { get; } = new List<string>();

        public string Version { get; set; } = "2.5.0-fake";
        public bool RejectKey { get; set; }
        public int StatusCodeOverride { get; set; }

        public SeerrHttpResponse Send(string method, string url, string jsonBody, string apiKey, string asUserId)
        {
            LastMethod = method;
            LastUrl = url;
            LastBody = jsonBody;
            LastSentKey = !string.IsNullOrEmpty(apiKey);
            LastKeyLength = apiKey != null ? apiKey.Length : 0;
            LastUser = asUserId;
            var path = url ?? "";
            var q = path.IndexOf('?');
            var pathOnly = q >= 0 ? path.Substring(0, q) : path;
            Calls.Add(method + " " + pathOnly + (string.IsNullOrEmpty(asUserId) ? "" : " user=" + asUserId));

            if (StatusCodeOverride != 0)
                return new SeerrHttpResponse { Status = StatusCodeOverride, Error = "forced " + StatusCodeOverride };

            if (pathOnly.EndsWith("/api/v1/status", StringComparison.OrdinalIgnoreCase))
                return Ok(new { version = Version, commitTag = "fake", updateAvailable = false, commitsBehind = 0 });

            if (LastSentKey && apiKey != FakeKey || RejectKey)
                return new SeerrHttpResponse { Status = 403, Error = "Invalid API key." };

            if (pathOnly.EndsWith("/api/v1/auth/me", StringComparison.OrdinalIgnoreCase))
                return Ok(Me());

            if (pathOnly.IndexOf("/api/v1/user/jellyfin/", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                var id = pathOnly.Substring(pathOnly.LastIndexOf('/') + 1);
                var u = FindByJellyfin(Uri.UnescapeDataString(id));
                if (u == null) return new SeerrHttpResponse { Status = 404, Error = "User not found." };
                return Ok(u);
            }

            if (pathOnly.EndsWith("/api/v1/user", StringComparison.OrdinalIgnoreCase) || pathOnly.IndexOf("/api/v1/user?", StringComparison.OrdinalIgnoreCase) >= 0)
                return Ok(new { results = Users(), pageInfo = new { results = 3, page = 1 } });

            if (pathOnly.IndexOf("/api/v1/movie/", StringComparison.OrdinalIgnoreCase) >= 0)
                return Movie(int.Parse(pathOnly.Substring(pathOnly.LastIndexOf('/') + 1)));

            if (pathOnly.IndexOf("/api/v1/tv/", StringComparison.OrdinalIgnoreCase) >= 0)
                return Tv(int.Parse(pathOnly.Substring(pathOnly.LastIndexOf('/') + 1)));

            if (pathOnly.IndexOf("/api/v1/search", StringComparison.OrdinalIgnoreCase) >= 0)
                return Ok(new { results = SearchResults(path) });

            if (method == "POST" && pathOnly.EndsWith("/api/v1/request", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrEmpty(asUserId))
                    return new SeerrHttpResponse { Status = 401, Error = "You must be logged in to request media." };
                if (string.IsNullOrEmpty(jsonBody) || jsonBody.IndexOf("\"userId\"", StringComparison.OrdinalIgnoreCase) >= 0)
                    return new SeerrHttpResponse { Status = 400, Error = "Request body must not include userId." };
                return Ok(new { id = 99, status = 1, mediaType = "movie" });
            }

            return new SeerrHttpResponse { Status = 404, Error = "not mocked: " + pathOnly };
        }

        static object Me() => new { id = 1, displayName = "Admin Fay", email = "admin@example.test", jellyfinUserId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", permissions = 2 };

        static object[] Users() => new object[]
        {
            Me(),
            new { id = 7, displayName = "Riley Rivera", email = "riley@example.test", jellyfinUserId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", permissions = 0 },
            new { id = 8, displayName = "Sam Patel", email = "sam@example.test", jellyfinUserId = (string)null, permissions = 0 }
        };

        static object FindByJellyfin(string id)
        {
            var want = UserMatcher.NormalizeId(id);
            foreach (var u in new[] { (id: "1", jf: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Admin Fay"), (id: "7", jf: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Riley Rivera") })
                if (UserMatcher.NormalizeId(u.jf) == want) return new { id = int.Parse(u.id), displayName = u.name, jellyfinUserId = u.jf };
            return null;
        }

        static SeerrHttpResponse Movie(int id)
        {
            if (id == 550) // Fight Club stand-in — already available
                return Ok(Media("The Sample Club", "movie", 550, 1999, SeerrMediaStatus.Available, null, "tt0137523"));
            if (id == 603) // pending request
                return Ok(Media("The Matrix Sample", "movie", 603, 1999, SeerrMediaStatus.Pending, SeerrRequestStatus.Pending, "tt0133093"));
            if (id == 27205) // requested / processing
                return Ok(Media("Inception Sample", "movie", 27205, 2010, SeerrMediaStatus.Processing, SeerrRequestStatus.Approved, "tt1375666"));
            if (id == 11) // declined
                return Ok(Media("Star Voyage", "movie", 11, 1977, SeerrMediaStatus.Unknown, SeerrRequestStatus.Declined, "tt0076759"));
            if (id == 78) // unknown, can request
                return Ok(Media("Blade Sample", "movie", 78, 1982, SeerrMediaStatus.Unknown, null, "tt0083658"));
            return Ok(Media("Unknown Title", "movie", id, 2000, SeerrMediaStatus.Unknown, null, null));
        }

        static SeerrHttpResponse Tv(int id)
        {
            if (id == 1396) // Breaking Bad stand-in — mixed seasons
            {
                var seasons = new[]
                {
                    new { seasonNumber = 1, name = "Season 1", episodeCount = 7, status = SeerrMediaStatus.Available },
                    new { seasonNumber = 2, name = "Season 2", episodeCount = 13, status = SeerrMediaStatus.Unknown },
                    new { seasonNumber = 3, name = "Season 3", episodeCount = 13, status = SeerrMediaStatus.Pending }
                };
                return Ok(new
                {
                    id,
                    name = "Chemistry Set",
                    firstAirDate = "2008-01-20",
                    mediaType = "tv",
                    externalIds = new { tvdbId = 81189, imdbId = "tt0903747" },
                    mediaInfo = new { status = SeerrMediaStatus.PartiallyAvailable, seasons },
                    seasons
                });
            }
            if (id == 1668)
                return Ok(new { id, name = "Friends Sample", firstAirDate = "1994-09-22", mediaType = "tv", mediaInfo = new { status = SeerrMediaStatus.Available }, seasons = new[] { new { seasonNumber = 1, name = "Season 1", status = SeerrMediaStatus.Available } } });
            return Ok(new { id, name = "Some Series", firstAirDate = "2020-01-01", mediaType = "tv", mediaInfo = new { status = SeerrMediaStatus.Unknown }, seasons = new[] { new { seasonNumber = 1, name = "Season 1", status = SeerrMediaStatus.Unknown } } });
        }

        static object Media(string title, string type, int tmdb, int year, int mediaStatus, int? reqStatus, string imdb)
        {
            object requests = reqStatus == null ? Array.Empty<object>() : new object[] { new { status = reqStatus.Value, createdAt = "2026-01-01T00:00:00Z" } };
            return new
            {
                id = tmdb,
                title,
                releaseDate = year + "-01-01",
                mediaType = type,
                imdbId = imdb,
                mediaInfo = new { status = mediaStatus, requests }
            };
        }

        static object[] SearchResults(string url)
        {
            return new object[]
            {
                new { id = 811, mediaType = "tv", name = "The Sample Show", firstAirDate = "2011-04-17", externalIds = new { tvdbId = 121361, imdbId = "tt0944947" } },
                new { id = 78, mediaType = "movie", title = "Blade Sample", releaseDate = "1982-06-25", imdbId = "tt0083658" }
            };
        }

        static SeerrHttpResponse Ok(object body)
        {
            return new SeerrHttpResponse { Status = 200, Body = JsonSerializer.Serialize(body) };
        }
    }
}
