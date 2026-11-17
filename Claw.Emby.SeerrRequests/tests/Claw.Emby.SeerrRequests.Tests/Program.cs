using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Claw.Emby.SeerrRequests;
using Claw.Emby.SeerrRequests.Core;
using Claw.Emby.SeerrRequests.Tests;

class Program
{
    static int P, F;
    static void Ok(bool c, string m)
    {
        Console.WriteLine((c ? "PASS " : "FAIL ") + m);
        if (c) P++; else F++;
    }

    static RequestItem Trailer(string name = "The Sample Club", string tmdb = "550") => new RequestItem
    {
        Id = "t1", Name = name, Type = "Trailer", Year = 1999, Tmdb = tmdb, LocationType = "FileSystem", Path = @"M:\TRAILERS\sample-club-trailer.mkv", MediaSourceCount = 1, LibraryId = "chan-trailers"
    };

    static RequestItem OwnedMovie() => new RequestItem
    {
        Id = "m1", Name = "The Sample Club", Type = "Movie", Year = 1999, Tmdb = "550", Path = @"M:\MOVIES\The Sample Club (1999)\movie.mkv", LocationType = "FileSystem", MediaSourceCount = 1, LibraryId = "lib-movies"
    };

    static RequestItem UnownedMovie(string tmdb = "78") => new RequestItem
    {
        Id = "m2", Name = "Blade Sample", Type = "Movie", Year = 1982, Tmdb = tmdb, LocationType = "Virtual", MediaSourceCount = 0, LibraryId = "lib-movies"
    };

    static RequestItem UnownedShow() => new RequestItem
    {
        Id = "s1", Name = "Chemistry Set", Type = "Series", Year = 2008, Tmdb = "1396", Tvdb = "81189", LocationType = "Virtual", MediaSourceCount = 0, LibraryId = "lib-tv"
    };

    static PluginConfiguration Cfg(Action<PluginConfiguration> edit = null)
    {
        var c = new PluginConfiguration { Enabled = true, SeerrUrl = "https://seerr.example.test", ApiKey = MockSeerr.FakeKey };
        edit?.Invoke(c);
        return c;
    }

    static int Main()
    {
        UrlAndKey();
        StatusMap();
        Eligible();
        Match();
        Activity();
        Patcher();
        Client();
        Console.WriteLine(P + " passed, " + F + " failed");
        return F == 0 ? 0 : 1;
    }

    static void UrlAndKey()
    {
        Ok(SeerrClient.NormalizeUrl("http://192.168.1.237:5055/") == "http://192.168.1.237:5055", "normalize: strip trailing slash");
        Ok(SeerrClient.NormalizeUrl("  http://192.168.1.237:5055  ") == "http://192.168.1.237:5055", "normalize: trim");
        Ok(SeerrClient.ValidateUrl("") != null && SeerrClient.ValidateUrl("ftp://x") != null, "validate rejects empty and ftp");
        Ok(SeerrClient.ValidateUrl("http://192.168.1.237:5055") == null, "validate accepts default URL");

        var key = MockSeerr.FakeKey;
        var masked = ApiKeyGuard.Mask(key);
        Ok(masked.StartsWith(ApiKeyGuard.MaskPrefix) && masked.EndsWith(key.Substring(key.Length - 4)) && masked.IndexOf(key) < 0, "mask hides the key and keeps last 4");
        Ok(ApiKeyGuard.IsMaskedOrEmpty("") && ApiKeyGuard.IsMaskedOrEmpty(masked) && ApiKeyGuard.IsMaskedOrEmpty("••••"), "masked or empty is detected");
        Ok(!ApiKeyGuard.IsMaskedOrEmpty("a-new-key"), "a new key is not treated as masked");
        Ok(ApiKeyGuard.ResolvePostedKey(masked, key) == key, "saving the masked value keeps the stored key");
        Ok(ApiKeyGuard.ResolvePostedKey("", key) == key, "blank posted key keeps the stored key");
        Ok(ApiKeyGuard.ResolvePostedKey("fresh-key", key) == "fresh-key", "a new posted key replaces the stored one");

        var dirty = "X-Api-Key: " + key + " Authorization: Bearer " + key;
        var clean = ApiKeyGuard.Sanitize(dirty, key);
        Ok(clean.IndexOf(key, StringComparison.Ordinal) < 0 && clean.IndexOf("REDACTED", StringComparison.Ordinal) >= 0, "sanitize strips the key and header values");
        Ok(ApiKeyGuard.Sanitize("ok " + key, key).IndexOf(key, StringComparison.Ordinal) < 0, "sanitize replaces a bare key");
    }

    static void StatusMap()
    {
        Ok(StatusMapper.From(SeerrMediaStatus.Available, null) == DisplayStatus.Available, "available media");
        Ok(StatusMapper.From(SeerrMediaStatus.Pending, null) == DisplayStatus.Pending, "pending media");
        Ok(StatusMapper.From(SeerrMediaStatus.Processing, SeerrRequestStatus.Approved) == DisplayStatus.Requested, "processing / approved is Requested");
        Ok(StatusMapper.From(SeerrMediaStatus.Unknown, SeerrRequestStatus.Declined) == DisplayStatus.Declined, "declined request");
        Ok(StatusMapper.From(SeerrMediaStatus.PartiallyAvailable, null) == DisplayStatus.Partial, "partial TV");
        Ok(StatusMapper.From(SeerrMediaStatus.Blocklisted, null) == DisplayStatus.Blocked, "blocklisted");
        Ok(StatusMapper.From(null, null) == DisplayStatus.None, "unknown is None");
        Ok(!StatusMapper.CanRequest(DisplayStatus.Available, false, null, false, null), "cannot re-request an available movie");
        Ok(!StatusMapper.CanRequest(DisplayStatus.Pending, false, null, false, null), "cannot duplicate a pending request");
        Ok(!StatusMapper.CanRequest(DisplayStatus.Requested, false, null, false, null), "cannot duplicate an approved request");
        Ok(StatusMapper.CanRequest(DisplayStatus.Declined, false, null, false, null), "a declined title can be requested again");
        Ok(StatusMapper.CanRequest(DisplayStatus.None, false, null, false, null), "a new title can be requested");

        var seasons = new List<SeerrSeasonInfo>
        {
            new SeerrSeasonInfo { SeasonNumber = 1, Status = DisplayStatus.Available, CanRequest = false },
            new SeerrSeasonInfo { SeasonNumber = 2, Status = DisplayStatus.None, CanRequest = true },
            new SeerrSeasonInfo { SeasonNumber = 3, Status = DisplayStatus.Pending, CanRequest = false }
        };
        Ok(StatusMapper.CanRequest(DisplayStatus.Partial, true, seasons, true, null), "all-seasons is allowed when one season is open");
        Ok(StatusMapper.CanRequest(DisplayStatus.Partial, true, seasons, false, new List<int> { 2 }), "season 2 can be requested");
        Ok(!StatusMapper.CanRequest(DisplayStatus.Partial, true, seasons, false, new List<int> { 1, 3 }), "already-available or pending seasons cannot be requested");
        Ok(StatusMapper.SeasonCanRequest(DisplayStatus.None) && StatusMapper.SeasonCanRequest(DisplayStatus.Declined) && !StatusMapper.SeasonCanRequest(DisplayStatus.Available), "season CanRequest flags");
    }

    static void Eligible()
    {
        Ok(Eligibility.IsTrailer(Trailer()) && Eligibility.ItemEligible(Trailer()), "trailer is eligible");
        Ok(!Eligibility.ItemEligible(OwnedMovie()), "owned movie with a file is not eligible");
        Ok(Eligibility.IsUnownedMovieOrShow(UnownedMovie()) && Eligibility.ItemEligible(UnownedMovie()), "virtual movie is unowned and eligible");
        Ok(Eligibility.ItemEligible(UnownedShow()), "virtual series is eligible");
        Ok(Eligibility.MediaTypeOf(UnownedShow()) == "tv" && Eligibility.MediaTypeOf(Trailer()) == "movie", "media type of show vs trailer");
        var season = new RequestItem { Id = "sn", Name = "Chemistry Set", Type = "Season", SeasonNumber = 2, LocationType = "Virtual", MediaSourceCount = 0 };
        Ok(Eligibility.ItemEligible(season) && Eligibility.MediaTypeOf(season) == "tv", "unowned season is a TV request");
        Ok(!Eligibility.ItemEligible(new RequestItem { Id = "p", Type = "Person", Name = "Someone" }), "people are not eligible");

        var cfg = Cfg();
        Ok(Eligibility.UserCanSee(cfg, "u1", "Alex", false), "default visibility is everyone");
        cfg.VisibilityMode = "admins";
        Ok(!Eligibility.UserCanSee(cfg, "u1", "Alex", false) && Eligibility.UserCanSee(cfg, "u2", "Pat", true), "admins mode");
        cfg.VisibilityMode = "allowlist";
        cfg.AllowedUserIds = new[] { "u1" };
        Ok(Eligibility.UserCanSee(cfg, "u1", "Alex", false) && !Eligibility.UserCanSee(cfg, "u9", "Other", true), "allowlist is by id, even if the user is an admin");
        cfg.AllowedUserIds = Array.Empty<string>();
        cfg.AllowedUserNames = new[] { "Alex" };
        Ok(Eligibility.UserCanSee(cfg, "u1", "Alex", false), "allowlist also matches user name");

        cfg = Cfg();
        Ok(Eligibility.LibraryAllowed(cfg, "anything"), "empty library list allows all");
        cfg.AllowedLibraryIds = new[] { "lib-movies" };
        Ok(Eligibility.LibraryAllowed(cfg, "lib-movies") && !Eligibility.LibraryAllowed(cfg, "lib-tv"), "library allowlist");
        Ok(Eligibility.MenuVisible(Cfg(), Trailer(), "u1", "Alex", false), "menu visible for a trailer when enabled");
        cfg = Cfg(c => c.Enabled = false);
        Ok(!Eligibility.MenuVisible(cfg, Trailer(), "u1", "Alex", false), "menu hidden when the plugin is off");
        Ok(Eligibility.UnmatchedMessage.IndexOf("never sent as the Seerr admin", StringComparison.OrdinalIgnoreCase) >= 0, "unmatched message mentions no admin fallback");
Ok(Eligibility.NotConfiguredMessage.IndexOf("isn't set up yet", StringComparison.OrdinalIgnoreCase) >= 0, "not-configured message is clear");
    }

    static void Match()
    {
        var users = new List<SeerrUserInfo>
        {
            new SeerrUserInfo { Id = "1", DisplayName = "Admin Fay", JellyfinUserId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", IsAdmin = true },
            new SeerrUserInfo { Id = "7", DisplayName = "Riley Rivera", JellyfinUserId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
            new SeerrUserInfo { Id = "8", DisplayName = "Sam Patel" }
        };

        var auto = UserMatcher.Match(Cfg(), "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB", "Riley", users);
        Ok(auto.Matched && auto.SeerrUserId == "7" && auto.How == "auto", "auto-match by stored Emby/Jellyfin id, dash/case insensitive");

        var adminSelf = UserMatcher.Match(Cfg(), "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Fay", users);
        Ok(adminSelf.Matched && adminSelf.SeerrUserId == "1" && adminSelf.How == "auto", "the admin Emby user may match their own Seerr account");

        var miss = UserMatcher.Match(Cfg(), "cccccccc-cccc-cccc-cccc-cccccccccccc", "Sam", users);
        Ok(!miss.Matched && miss.SeerrUserId == null && miss.Message == Eligibility.UnmatchedMessage, "unmatched user is not given a Seerr id");
        Ok(miss.SeerrUserId != "1", "unmatched user does not fall back to admin id 1");

        var cfg = Cfg(c => c.UserMaps = new[]
        {
            new UserMapEntry { EmbyUserId = "cccccccc-cccc-cccc-cccc-cccccccccccc", EmbyUserName = "Sam", SeerrUserId = "8", SeerrUserName = "Sam Patel", Mode = "manual" }
        });
        var man = UserMatcher.Match(cfg, "cccccccc-cccc-cccc-cccc-cccccccccccc", "Sam", users);
        Ok(man.Matched && man.SeerrUserId == "8" && man.How == "manual", "manual override matches an otherwise unmatched user");

        cfg.UserMaps = new[]
        {
            new UserMapEntry { EmbyUserId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", SeerrUserId = "8", SeerrUserName = "Sam Patel", Mode = "manual" }
        };
        var win = UserMatcher.Match(cfg, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Riley", users);
        Ok(win.Matched && win.SeerrUserId == "8" && win.How == "manual", "manual override wins over auto-match");

        var empty = UserMatcher.Match(Cfg(), null, null, users);
        Ok(!empty.Matched && empty.SeerrUserId != "1", "no Emby identity does not become admin");
    }

    static void Activity()
    {
        var dir = Path.Combine(Path.GetTempPath(), "claw-seerr-tests-" + Guid.NewGuid().ToString("N"));
        var store = new ActivityStore(dir, 3);
        store.Add(new ActivityEntry { Title = "One", Result = "Requested", EmbyUserName = "Riley Rivera" });
        store.Add(new ActivityEntry { Title = "Two", Result = "Failed", EmbyUserName = "Sam Patel" });
        store.Add(new ActivityEntry { Title = "Three", Result = "Blocked", EmbyUserName = "Riley Rivera" });
        store.Add(new ActivityEntry { Title = "Four", Result = "Requested", EmbyUserName = "Alex Kim" });
        var list = store.List();
        Ok(list.Count == 3 && list[0].Title == "Four" && list[2].Title == "Two", "activity is newest first and capped");
        var again = new ActivityStore(dir, 3).List();
        Ok(again.Count == 3 && again[0].Title == "Four", "activity reloads from disk");
        Directory.Delete(dir, true);
    }

    static void Patcher()
    {
        var html = "<html><body>\n    <script src=\"apploader.js\"></script>\n</body></html>";
        var once = IndexHtmlPatcher.AddScriptTag(html, "claw-seerr-requests.js");
        Ok(once.IndexOf("<script src=\"claw-seerr-requests.js\" defer></script>", StringComparison.Ordinal) >= 0
            && once.IndexOf("claw-seerr-requests.js") < once.IndexOf("apploader.js"), "script tag is inserted before apploader.js");
        Ok(IndexHtmlPatcher.AddScriptTag(once, "claw-seerr-requests.js") == once, "patcher is idempotent");
        var fallback = IndexHtmlPatcher.AddScriptTag("<html><body>hi</body></html>", "claw-seerr-requests.js");
        Ok(fallback.Contains("claw-seerr-requests.js") && fallback.Contains("</body>"), "falls back to before </body>");
    }

    static void Client()
    {
        var mock = new MockSeerr();
        var logs = new List<string>();
        var client = new SeerrClient("https://seerr.example.test/", MockSeerr.FakeKey, mock, line => logs.Add(line));

        var st = client.GetStatus();
        Ok(st.Status == 200 && client.StatusVersion(st) == "2.5.0-fake", "GET /api/v1/status returns the fake version");
        Ok(!mock.LastSentKey, "status is called without an API key");

        var me = client.GetMe();
        Ok(me != null && me.DisplayName == "Admin Fay" && mock.LastSentKey && mock.LastKeyLength == MockSeerr.FakeKey.Length, "auth/me sends the key (length only, value not printed)");
        Ok(logs.All(l => l.IndexOf(MockSeerr.FakeKey, StringComparison.Ordinal) < 0), "client logs never contain the API key");

        var users = client.ListUsers();
        Ok(users.Count == 3 && users.Any(u => u.Id == "7" && u.JellyfinUserId != null), "list users returns the fake roster");

        var byJf = client.GetUserByJellyfinId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        Ok(byJf != null && byJf.Id == "7", "GET /user/jellyfin/{id} auto-match endpoint");
        Ok(client.GetUserByJellyfinId("no-such-user") == null, "unknown jellyfin id is 404");

        var avail = client.GetMovie(550);
        Ok(avail != null && avail.Display == DisplayStatus.Available && avail.Title.Contains("Sample Club"), "movie 550 is Available");
        var pending = client.GetMovie(603);
        Ok(pending.Display == DisplayStatus.Pending, "movie 603 is Pending");
        var req = client.GetMovie(27205);
        Ok(req.Display == DisplayStatus.Requested, "movie 27205 is Requested");
        var declined = client.GetMovie(11);
        Ok(declined.Display == DisplayStatus.Declined, "movie 11 is Declined");
        var open = client.GetMovie(78);
        Ok(open.Display == DisplayStatus.None && StatusMapper.CanRequest(open.Display, false, null, false, null), "movie 78 can be requested");

        var tv = client.GetTv(1396);
        Ok(tv.Display == DisplayStatus.Partial && tv.Seasons.Count == 3, "Chemistry Set is partially available with 3 seasons");
        Ok(tv.Seasons[0].CanRequest == false && tv.Seasons[1].CanRequest && tv.Seasons[2].CanRequest == false, "season 2 is the only requestable season");
        Ok(tv.TvdbId == 81189, "tvdb id is parsed from externalIds");

        var lookup = client.Lookup(new RequestItem { Name = "The Sample Show", Type = "Series", Tvdb = "121361", Year = 2011 });
        Ok(lookup != null && lookup.TmdbId == 811, "TVDb-only item is found via search");

        var sent = client.CreateRequest("7", "movie", 78, null);
        Ok(sent.Status == 200 && mock.LastUser == "7" && mock.LastSentKey, "create request sends X-API-User 7 and the key");
        Ok(mock.LastBody != null && mock.LastBody.IndexOf("\"userId\"", StringComparison.OrdinalIgnoreCase) < 0, "request body has no userId (no admin fallback field)");
        Ok(mock.LastBody.Contains("\"mediaId\":78") && mock.LastBody.Contains("\"mediaType\":\"movie\""), "request body has mediaType and mediaId");

        var tvReq = client.CreateRequest("7", "tv", 1396, "2");
        Ok(tvReq.Status == 200 && mock.LastBody.Contains("\"seasons\":[2]"), "TV request for season 2 is an array");
        var all = client.CreateRequest("7", "tv", 1396, "all");
        Ok(all.Status == 200 && mock.LastBody.Contains("\"seasons\":\"all\""), "TV request for all seasons uses the all token");

        var nobody = client.CreateRequest("", "movie", 78, null);
        Ok(nobody.Status == 0 && nobody.Error == Eligibility.UnmatchedMessage, "create request without a Seerr user is refused locally");

        var bad = new SeerrClient("https://seerr.example.test", "wrong-key", mock);
        var denied = bad.GetMe();
        Ok(denied == null, "wrong key is rejected (auth/me)");
        Ok(logs.All(l => l.IndexOf(MockSeerr.FakeKey, StringComparison.Ordinal) < 0), "logs still clean after all client calls");
    }
}
