using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Web;

namespace Claw.Emby.SeerrRequests.Core
{
    public class SeerrClient
    {
        readonly ISeerrTransport _transport;
        readonly Action<string> _log;
        readonly string _apiKey;

        public SeerrClient(string baseUrl, string apiKey, ISeerrTransport transport, Action<string> log = null)
        {
            BaseUrl = NormalizeUrl(baseUrl);
            _apiKey = apiKey ?? "";
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _log = log;
        }

        public string BaseUrl { get; }

        public static string NormalizeUrl(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return "";
            var t = url.Trim();
            while (t.EndsWith("/")) t = t.Substring(0, t.Length - 1);
            return t;
        }

        public static string ValidateUrl(string url)
        {
            var t = NormalizeUrl(url);
            if (t.Length == 0) return "Enter a Seerr URL.";
            if (!Uri.TryCreate(t, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps))
                return "The Seerr URL must start with http:// or https://.";
            return null;
        }

        public SeerrHttpResponse GetStatus()
        {
            // Public endpoint: no API key, no user header.
            return Call("GET", "/api/v1/status", null, sendKey: false, asUserId: null);
        }

        public SeerrUserInfo GetMe()
        {
            var r = Call("GET", "/api/v1/auth/me", null, true, null);
            if (r.Status != 200) return null;
            return ParseUser(ParseJson(r.Body));
        }

        public List<SeerrUserInfo> ListUsers()
        {
            var list = new List<SeerrUserInfo>();
            var skip = 0;
            const int take = 100;
            for (var page = 0; page < 20; page++)
            {
                var r = Call("GET", "/api/v1/user?take=" + take + "&skip=" + skip, null, true, null);
                if (r.Status != 200) break;
                var doc = ParseJson(r.Body);
                var batch = UsersFrom(doc);
                list.AddRange(batch);
                if (batch.Count < take) break;
                skip += take;
            }
            return list;
        }

        public SeerrUserInfo GetUserByJellyfinId(string embyOrJellyfinUserId)
        {
            if (string.IsNullOrWhiteSpace(embyOrJellyfinUserId)) return null;
            var path = "/api/v1/user/jellyfin/" + Uri.EscapeDataString(embyOrJellyfinUserId.Trim());
            var r = Call("GET", path, null, true, null);
            if (r.Status != 200) return null;
            return ParseUser(ParseJson(r.Body));
        }

        public SeerrMediaInfo GetMovie(int tmdbId)
        {
            return ParseMedia(Call("GET", "/api/v1/movie/" + tmdbId, null, true, null), "movie", tmdbId);
        }

        public SeerrMediaInfo GetTv(int tmdbId)
        {
            return ParseMedia(Call("GET", "/api/v1/tv/" + tmdbId, null, true, null), "tv", tmdbId);
        }

        public SeerrMediaInfo Lookup(RequestItem item)
        {
            if (item == null) return null;
            var type = Eligibility.MediaTypeOf(item);
            if (TryInt(item.Tmdb, out var tmdb))
                return type == "tv" ? GetTv(tmdb) : GetMovie(tmdb);

            var hits = Search(item.Name ?? "");
            var match = PickSearch(hits, item, type);
            if (match == null) return null;
            if (match.TmdbId == null) return match;
            return match.MediaType == "tv" ? GetTv(match.TmdbId.Value) : GetMovie(match.TmdbId.Value);
        }

        public List<SeerrMediaInfo> Search(string query)
        {
            var list = new List<SeerrMediaInfo>();
            if (string.IsNullOrWhiteSpace(query)) return list;
            var r = Call("GET", "/api/v1/search?query=" + Uri.EscapeDataString(query.Trim()) + "&page=1", null, true, null);
            if (r.Status != 200) return list;
            var doc = ParseJson(r.Body);
            var results = doc.ValueKind == JsonValueKind.Object && doc.TryGetProperty("results", out var arr) ? arr : doc;
            if (results.ValueKind != JsonValueKind.Array) return list;
            foreach (var el in results.EnumerateArray())
            {
                var info = ParseMediaElement(el, null, 0);
                if (info != null) list.Add(info);
            }
            return list;
        }

        /// <summary>Create a request as the given Seerr user. The body never includes userId (no admin fallback).</summary>
        public SeerrHttpResponse CreateRequest(string asUserId, string mediaType, int mediaId, string seasons)
        {
            if (string.IsNullOrWhiteSpace(asUserId))
                return new SeerrHttpResponse { Status = 0, Error = Eligibility.UnmatchedMessage };

            var sb = new StringBuilder();
            sb.Append("{\"mediaType\":").Append(JsonSerializer.Serialize(mediaType ?? "movie"));
            sb.Append(",\"mediaId\":").Append(mediaId);
            if (string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(seasons))
            {
                if (string.Equals(seasons.Trim(), "all", StringComparison.OrdinalIgnoreCase))
                    sb.Append(",\"seasons\":\"all\"");
                else
                {
                    var parts = seasons.Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    sb.Append(",\"seasons\":[");
                    var first = true;
                    foreach (var p in parts)
                    {
                        if (!int.TryParse(p.Trim(), out var n)) continue;
                        if (!first) sb.Append(',');
                        sb.Append(n);
                        first = false;
                    }
                    sb.Append(']');
                }
            }
            sb.Append('}');
            return Call("POST", "/api/v1/request", sb.ToString(), true, asUserId);
        }

        public string StatusVersion(SeerrHttpResponse statusResponse)
        {
            if (statusResponse == null || statusResponse.Status != 200) return null;
            var doc = ParseJson(statusResponse.Body);
            if (doc.ValueKind == JsonValueKind.Object && doc.TryGetProperty("version", out var v))
                return v.GetString();
            return null;
        }

        SeerrHttpResponse Call(string method, string path, string body, bool sendKey, string asUserId)
        {
            if (string.IsNullOrEmpty(BaseUrl))
                return new SeerrHttpResponse { Status = 0, Error = Eligibility.NotConfiguredMessage };
            var url = BaseUrl + path;
            var key = sendKey ? _apiKey : "";
            Log(method + " " + path + (string.IsNullOrWhiteSpace(asUserId) ? "" : (" as user " + asUserId)));
            SeerrHttpResponse r;
            try
            {
                r = _transport.Send(method, url, body, key, asUserId) ?? new SeerrHttpResponse { Status = 0, Error = "No response from Seerr." };
            }
            catch (Exception ex)
            {
                r = new SeerrHttpResponse { Status = 0, Error = ApiKeyGuard.Sanitize(ex.Message, _apiKey) };
            }
            r.Error = ApiKeyGuard.Sanitize(r.Error, _apiKey);
            r.Body = r.Body ?? "";
            Log("-> " + r.Status + (string.IsNullOrWhiteSpace(r.Error) ? "" : (" " + r.Error)));
            return r;
        }

        void Log(string line)
        {
            if (_log == null) return;
            _log(ApiKeyGuard.Sanitize(line, _apiKey));
        }

        static SeerrMediaInfo PickSearch(List<SeerrMediaInfo> hits, RequestItem item, string type)
        {
            if (hits == null || hits.Count == 0) return null;
            SeerrMediaInfo byTvdb = null, byImdb = null, byTitleYear = null, byTitle = null;
            var wantTvdb = item.Tvdb;
            var wantImdb = item.Imdb;
            var wantTitle = NormTitle(item.Name);
            foreach (var h in hits)
            {
                if (h == null) continue;
                if (!string.IsNullOrWhiteSpace(type) && !string.Equals(h.MediaType, type, StringComparison.OrdinalIgnoreCase)
                    && h.MediaType != null) continue;
                if (wantTvdb != null && h.TvdbId != null && string.Equals(h.TvdbId.ToString(), wantTvdb.Trim(), StringComparison.OrdinalIgnoreCase))
                    byTvdb ??= h;
                if (wantImdb != null && !string.IsNullOrWhiteSpace(h.ImdbId) && string.Equals(h.ImdbId, wantImdb.Trim(), StringComparison.OrdinalIgnoreCase))
                    byImdb ??= h;
                if (wantTitle != null && NormTitle(h.Title) == wantTitle)
                {
                    if (item.Year != null && h.Year != null && item.Year == h.Year) byTitleYear ??= h;
                    else byTitle ??= h;
                }
            }
            return byTvdb ?? byImdb ?? byTitleYear ?? byTitle;
        }

        static string NormTitle(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            var t = s.Trim().ToLowerInvariant();
            t = System.Text.RegularExpressions.Regex.Replace(t, @"\s*\(\d{4}\)\s*$", "");
            t = System.Text.RegularExpressions.Regex.Replace(t, @"[^a-z0-9]+", " ").Trim();
            if (t.StartsWith("the ")) t = t.Substring(4);
            return t.Length == 0 ? null : t;
        }

        static JsonElement ParseJson(string body)
        {
            if (string.IsNullOrWhiteSpace(body)) return default;
            try { using var doc = JsonDocument.Parse(body); return doc.RootElement.Clone(); }
            catch { return default; }
        }

        static List<SeerrUserInfo> UsersFrom(JsonElement doc)
        {
            var list = new List<SeerrUserInfo>();
            JsonElement arr = default;
            if (doc.ValueKind == JsonValueKind.Array) arr = doc;
            else if (doc.ValueKind == JsonValueKind.Object && doc.TryGetProperty("results", out var r)) arr = r;
            if (arr.ValueKind != JsonValueKind.Array) return list;
            foreach (var el in arr.EnumerateArray())
            {
                var u = ParseUser(el);
                if (u != null) list.Add(u);
            }
            return list;
        }

        public static SeerrUserInfo ParseUser(JsonElement el)
        {
            if (el.ValueKind != JsonValueKind.Object) return null;
            var id = Str(el, "id");
            if (string.IsNullOrEmpty(id)) return null;
            return new SeerrUserInfo
            {
                Id = id,
                DisplayName = First(el, "displayName", "username", "plexUsername", "jellyfinUsername"),
                Email = Str(el, "email"),
                JellyfinUserId = First(el, "jellyfinUserId", "embyUserId"),
                JellyfinUsername = First(el, "jellyfinUsername", "embyUsername"),
                IsAdmin = IsAdmin(el)
            };
        }

        static bool IsAdmin(JsonElement el)
        {
            if (Str(el, "id") == "1") return true;
            if (el.TryGetProperty("permissions", out var p) && p.ValueKind == JsonValueKind.Number)
            {
                // Seerr ADMIN permission bit is 2. We only use this as a label, never as a fallback identity.
                try { return (p.GetInt32() & 2) == 2; } catch { return false; }
            }
            return false;
        }

        static SeerrMediaInfo ParseMedia(SeerrHttpResponse r, string fallbackType, int tmdbId)
        {
            if (r == null || r.Status != 200) return null;
            return ParseMediaElement(ParseJson(r.Body), fallbackType, tmdbId);
        }

        static SeerrMediaInfo ParseMediaElement(JsonElement el, string fallbackType, int tmdbId)
        {
            if (el.ValueKind != JsonValueKind.Object) return null;
            var info = new SeerrMediaInfo();
            info.MediaType = (Str(el, "mediaType") ?? fallbackType ?? GuessType(el) ?? "movie").ToLowerInvariant();
            info.Title = First(el, "title", "name", "originalTitle", "originalName");
            info.Year = YearOf(el);
            info.TmdbId = Int(el, "tmdbId") ?? Int(el, "id") ?? (tmdbId > 0 ? tmdbId : (int?)null);
            info.ImdbId = First(el, "imdbId") ?? Ext(el, "imdbId");
            info.TvdbId = Int(el, "tvdbId") ?? ExtInt(el, "tvdbId");

            JsonElement media = default;
            if (el.TryGetProperty("mediaInfo", out var mi) && mi.ValueKind == JsonValueKind.Object) media = mi;
            else media = el;
            info.MediaStatus = Int(media, "status");
            info.RequestStatus = LatestRequestStatus(media);
            info.Display = StatusMapper.From(info.MediaStatus, info.RequestStatus);
            info.Seasons = ParseSeasons(el, media);
            return info;
        }

        static List<SeerrSeasonInfo> ParseSeasons(JsonElement root, JsonElement media)
        {
            var map = new Dictionary<int, SeerrSeasonInfo>();
            void take(JsonElement arr, bool fromMedia)
            {
                if (arr.ValueKind != JsonValueKind.Array) return;
                foreach (var s in arr.EnumerateArray())
                {
                    var n = Int(s, "seasonNumber") ?? Int(s, "season") ?? 0;
                    if (n <= 0) continue; // skip "Specials"
                    if (!map.TryGetValue(n, out var row))
                    {
                        row = new SeerrSeasonInfo { SeasonNumber = n, Name = "Season " + n };
                        map[n] = row;
                    }
                    var name = First(s, "name", "title");
                    if (!string.IsNullOrWhiteSpace(name)) row.Name = name;
                    var ep = Int(s, "episodeCount") ?? Int(s, "episode_count");
                    if (ep != null) row.EpisodeCount = ep;
                    if (fromMedia || Int(s, "status") != null)
                    {
                        var st = Int(s, "status");
                        if (st != null) row.Status = StatusMapper.SeasonFrom(st);
                    }
                }
            }
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("seasons", out var rs)) take(rs, false);
            if (media.ValueKind == JsonValueKind.Object && media.TryGetProperty("seasons", out var ms)) take(ms, true);
            var list = new List<SeerrSeasonInfo>(map.Values);
            list.Sort((a, b) => a.SeasonNumber.CompareTo(b.SeasonNumber));
            foreach (var s in list)
            {
                if (string.IsNullOrEmpty(s.Status)) s.Status = DisplayStatus.None;
                s.CanRequest = StatusMapper.SeasonCanRequest(s.Status);
            }
            return list;
        }

        static int? LatestRequestStatus(JsonElement media)
        {
            if (media.ValueKind != JsonValueKind.Object || !media.TryGetProperty("requests", out var arr) || arr.ValueKind != JsonValueKind.Array)
                return null;
            int? last = null;
            DateTimeOffset best = DateTimeOffset.MinValue;
            foreach (var r in arr.EnumerateArray())
            {
                var st = Int(r, "status");
                if (st == null) continue;
                var when = DateOf(r, "createdAt", "updatedAt") ?? DateTimeOffset.MinValue;
                if (last == null || when >= best) { last = st; best = when; }
            }
            return last;
        }

        static string GuessType(JsonElement el)
        {
            if (el.TryGetProperty("firstAirDate", out _) || el.TryGetProperty("name", out _)) return "tv";
            if (el.TryGetProperty("title", out _) || el.TryGetProperty("releaseDate", out _)) return "movie";
            return null;
        }

        static int? YearOf(JsonElement el)
        {
            var y = Int(el, "year");
            if (y != null) return y;
            foreach (var k in new[] { "releaseDate", "firstAirDate" })
            {
                var s = Str(el, k);
                if (!string.IsNullOrEmpty(s) && s.Length >= 4 && int.TryParse(s.Substring(0, 4), out var n)) return n;
            }
            return null;
        }

        static string Ext(JsonElement el, string name)
        {
            if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty("externalIds", out var x) || x.ValueKind != JsonValueKind.Object)
                return null;
            return Str(x, name);
        }

        static int? ExtInt(JsonElement el, string name)
        {
            if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty("externalIds", out var x) || x.ValueKind != JsonValueKind.Object)
                return null;
            return Int(x, name);
        }

        static string First(JsonElement el, params string[] names)
        {
            foreach (var n in names)
            {
                var s = Str(el, n);
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
            return null;
        }

        static string Str(JsonElement el, string name)
        {
            if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(name, out var v)) return null;
            if (v.ValueKind == JsonValueKind.String) return v.GetString();
            if (v.ValueKind == JsonValueKind.Number) return v.ToString();
            if (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) return v.GetBoolean().ToString();
            return null;
        }

        static int? Int(JsonElement el, string name)
        {
            if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(name, out var v)) return null;
            if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)) return n;
            if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s)) return s;
            return null;
        }

        static bool Bool(JsonElement el, string name) => el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out _);

        static DateTimeOffset? DateOf(JsonElement el, params string[] names)
        {
            foreach (var n in names)
            {
                var s = Str(el, n);
                if (s != null && DateTimeOffset.TryParse(s, out var d)) return d;
            }
            return null;
        }

        static bool TryInt(string s, out int n)
        {
            n = 0;
            return !string.IsNullOrWhiteSpace(s) && int.TryParse(s.Trim(), out n);
        }
    }

    /// <summary>Live HTTP transport. Adds X-Api-Key and X-API-User here only; it never writes those values to a log.</summary>
    public sealed class HttpSeerrTransport : ISeerrTransport, IDisposable
    {
        readonly HttpClient _http;

        public HttpSeerrTransport(TimeSpan? timeout = null)
        {
            _http = new HttpClient { Timeout = timeout ?? TimeSpan.FromSeconds(15) };
        }

        public SeerrHttpResponse Send(string method, string url, string jsonBody, string apiKey, string asUserId)
        {
            using var req = new HttpRequestMessage(new HttpMethod(method), url);
            req.Headers.TryAddWithoutValidation("Accept", "application/json");
            if (!string.IsNullOrWhiteSpace(apiKey))
                req.Headers.TryAddWithoutValidation("X-Api-Key", apiKey);
            if (!string.IsNullOrWhiteSpace(asUserId))
                req.Headers.TryAddWithoutValidation("X-API-User", asUserId);
            if (jsonBody != null)
                req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
            try
            {
                using var resp = _http.Send(req);
                var body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                var err = resp.IsSuccessStatusCode ? null : ExtractError(body, (int)resp.StatusCode);
                return new SeerrHttpResponse { Status = (int)resp.StatusCode, Body = body, Error = err };
            }
            catch (Exception ex)
            {
                return new SeerrHttpResponse { Status = 0, Error = ApiKeyGuard.Sanitize(ex.Message, apiKey) };
            }
        }

        static string ExtractError(string body, int status)
        {
            if (!string.IsNullOrWhiteSpace(body))
            {
                try
                {
                    using var doc = JsonDocument.Parse(body);
                    var r = doc.RootElement;
                    if (r.ValueKind == JsonValueKind.Object)
                    {
                        if (r.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String) return m.GetString();
                        if (r.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String) return e.GetString();
                    }
                }
                catch { /* use status */ }
            }
            return "Seerr returned HTTP " + status + ".";
        }

        public void Dispose() => _http.Dispose();
    }
}
