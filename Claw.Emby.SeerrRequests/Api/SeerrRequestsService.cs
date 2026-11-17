using System;
using System.Collections.Generic;
using System.Linq;
using Claw.Emby.SeerrRequests.Core;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Services;

namespace Claw.Emby.SeerrRequests.Api
{
    [Route("/ClawSeerrRequests/Info", "GET", Summary = "Seerr Requests: version, enable switch and whether this user can see the menu")]
    [Authenticated]
    public class GetSeerrInfo : IReturn<SeerrInfoDto> { }

    [Route("/ClawSeerrRequests/ItemStatus", "GET", Summary = "Seerr Requests: status and eligibility for one item")]
    [Authenticated]
    public class GetSeerrItemStatus : IReturn<ItemStatusDto>
    {
        public string Id { get; set; }
    }

    [Route("/ClawSeerrRequests/Request", "POST", Summary = "Seerr Requests: send a request as the matched Seerr user")]
    [Authenticated]
    public class PostSeerrRequest : IReturn<RequestResultDto>
    {
        public string Id { get; set; }
        /// <summary>TV only: "all" or a comma-separated list of season numbers.</summary>
        public string Seasons { get; set; }
    }

    [Route("/ClawSeerrRequests/Activity", "GET", Summary = "Seerr Requests: recent request activity")]
    [Authenticated(Roles = "Admin")]
    public class GetSeerrActivity : IReturn<ActivityListDto> { }

    [Route("/ClawSeerrRequests/Settings", "GET", Summary = "Seerr Requests: settings (API key is masked)")]
    [Authenticated(Roles = "Admin")]
    public class GetSeerrSettings : IReturn<SettingsDto> { }

    [Route("/ClawSeerrRequests/Settings", "POST", Summary = "Seerr Requests: save settings. A masked or blank API key keeps the stored key.")]
    [Authenticated(Roles = "Admin")]
    public class PostSeerrSettings : IReturn<SettingsDto>
    {
        public bool? Enabled { get; set; }
        public string SeerrUrl { get; set; }
        public string ApiKey { get; set; }
        public string VisibilityMode { get; set; }
        public string[] AllowedUserIds { get; set; }
        public string[] AllowedUserNames { get; set; }
        public string[] AllowedLibraryIds { get; set; }
        public UserMapEntry[] UserMaps { get; set; }
    }

    [Route("/ClawSeerrRequests/TestConnection", "POST", Summary = "Seerr Requests: GET /api/v1/status, and if a key is set, verify it")]
    [Authenticated(Roles = "Admin")]
    public class PostSeerrTestConnection : IReturn<TestConnectionDto>
    {
        public string SeerrUrl { get; set; }
        public string ApiKey { get; set; }
    }

    [Route("/ClawSeerrRequests/People", "GET", Summary = "Seerr Requests: Emby users, Seerr users and current mappings")]
    [Authenticated(Roles = "Admin")]
    public class GetSeerrPeople : IReturn<PeopleDto> { }

    [Route("/ClawSeerrRequests/Libraries", "GET", Summary = "Seerr Requests: libraries and channels for the visibility list")]
    [Authenticated(Roles = "Admin")]
    public class GetSeerrLibraries : IReturn<LibrariesDto> { }

    public class SeerrInfoDto
    {
        public bool Enabled { get; set; }
        public string Version { get; set; }
        public bool CanRequest { get; set; }
        public bool Configured { get; set; }
        public string MenuName { get; set; } = Eligibility.MenuName;
    }

    public class ItemStatusDto
    {
        public bool Visible { get; set; }
        public bool CanRequest { get; set; }
        public string Message { get; set; }
        public string Title { get; set; }
        public int? Year { get; set; }
        public string MediaType { get; set; }
        public string ItemType { get; set; }
        public string TmdbId { get; set; }
        public string TvdbId { get; set; }
        public string Status { get; set; }
        public string SeerrUserName { get; set; }
        public string How { get; set; }
        public List<SeerrSeasonInfo> Seasons { get; set; }
        public int? SuggestedSeason { get; set; }
    }

    public class RequestResultDto
    {
        public bool Ok { get; set; }
        public string Result { get; set; }
        public string Detail { get; set; }
        public string Status { get; set; }
        public ActivityEntry Activity { get; set; }
    }

    public class ActivityListDto
    {
        public List<ActivityEntry> Items { get; set; } = new List<ActivityEntry>();
    }

    public class SettingsDto
    {
        public bool Enabled { get; set; }
        public string SeerrUrl { get; set; }
        public string ApiKey { get; set; }
        public bool ApiKeySet { get; set; }
        public string VisibilityMode { get; set; }
        public string[] AllowedUserIds { get; set; }
        public string[] AllowedUserNames { get; set; }
        public string[] AllowedLibraryIds { get; set; }
        public UserMapEntry[] UserMaps { get; set; }
        public string Version { get; set; }
        public string Script { get; set; }
    }

    public class TestConnectionDto
    {
        public bool Ok { get; set; }
        public bool KeyOk { get; set; }
        public string Version { get; set; }
        public string Message { get; set; }
    }

    public class PeopleDto
    {
        public List<EmbyUserRow> EmbyUsers { get; set; } = new List<EmbyUserRow>();
        public List<SeerrUserInfo> SeerrUsers { get; set; } = new List<SeerrUserInfo>();
        public string Error { get; set; }
    }

    public class EmbyUserRow
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public bool IsAdmin { get; set; }
        public string SeerrUserId { get; set; }
        public string SeerrUserName { get; set; }
        public string How { get; set; }
    }

    public class LibrariesDto
    {
        public List<LibraryRow> Items { get; set; } = new List<LibraryRow>();
    }

    public class LibraryRow
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
    }

    public class SeerrRequestsService : IService, IRequiresRequest
    {
        public ILibraryManager Library { get; set; }
        public IUserManager UserManager { get; set; }
        public IAuthorizationContext Auth { get; set; }
        public ILogManager LogManager { get; set; }
        public IRequest Request { get; set; }

        /// <summary>Optional override for tests; the live plugin constructs a client per call.</summary>
        internal static Func<PluginConfiguration, ILogger, SeerrClient> ClientFactory { get; set; }

        /// <summary>Optional override for tests.</summary>
        internal static Func<ActivityStore> StoreFactory { get; set; }

        public object Get(GetSeerrInfo r)
        {
            var cfg = Config();
            var user = CurrentUser();
            var can = cfg.Enabled && user != null && Eligibility.UserCanSee(cfg, user.Id.ToString(), user.Name, IsAdmin(user));
            return new SeerrInfoDto
            {
                Enabled = cfg.Enabled,
                Version = VersionString(),
                CanRequest = can,
                Configured = IsConfigured(cfg),
                MenuName = Eligibility.MenuName
            };
        }

        public object Get(GetSeerrItemStatus r)
        {
            var cfg = Config();
            var user = CurrentUser();
            var item = Describe(r != null ? r.Id : null);
            return BuildStatus(cfg, user, item);
        }

        T ReadBody<T>(T dto) where T : class
        {
            try
            {
                if (Request == null) return dto;
                var ct = Request.ContentType ?? "";
                if (ct.IndexOf("json", StringComparison.OrdinalIgnoreCase) < 0) return dto;
                using (var reader = new System.IO.StreamReader(Request.InputStream, System.Text.Encoding.UTF8, true, 1024, true))
                {
                    var json = reader.ReadToEnd();
                    if (string.IsNullOrWhiteSpace(json)) return dto;
                    var parsed = System.Text.Json.JsonSerializer.Deserialize<T>(json, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    return parsed ?? dto;
                }
            }
            catch { return dto; }
        }

        public object Post(PostSeerrRequest r)
        {
            r = ReadBody(r) ?? r;

            var cfg = Config();
            var user = CurrentUser();
            var item = Describe(r != null ? r.Id : null);
            var status = BuildStatus(cfg, user, item);
            var seasons = r != null ? r.Seasons : null;
            var act = NewActivity(user, item, seasons);

            if (!status.Visible)
                return Fail(act, "Blocked", status.Message ?? Eligibility.NotEligibleMessage, status.Status);
            if (!status.CanRequest)
                return Fail(act, "Blocked", status.Message ?? "This title cannot be requested right now.", status.Status);
            if (user == null)
                return Fail(act, "Blocked", Eligibility.UnmatchedMessage, status.Status);

            var client = MakeClient(cfg);
            var users = SafeUsers(client);
            var match = UserMatcher.Match(cfg, user.Id.ToString(), user.Name, users);
            if (!match.Matched)
                return Fail(act, "Unmatched", match.Message ?? Eligibility.UnmatchedMessage, status.Status);

            act.SeerrUserId = match.SeerrUserId;
            act.SeerrUserName = match.SeerrUserName;

            if (!TryInt(status.TmdbId, out var tmdb))
                return Fail(act, "Failed", Eligibility.NoIdMessage, status.Status);

            var mediaType = status.MediaType ?? "movie";
            if (mediaType == "tv")
            {
                var wanted = ParseSeasons(seasons);
                if (!StatusMapper.CanRequest(status.Status, true, status.Seasons, wanted.All, wanted.Numbers))
                    return Fail(act, "Blocked", "Those seasons are already requested or available.", status.Status);
                if (!wanted.All && (wanted.Numbers == null || wanted.Numbers.Count == 0) && item != null && item.SeasonNumber != null)
                    seasons = item.SeasonNumber.Value.ToString();
                if (string.IsNullOrWhiteSpace(seasons)) seasons = "all";
                act.Seasons = seasons;
            }
            else if (!StatusMapper.CanRequest(status.Status, false, null, false, null))
            {
                return Fail(act, "Blocked", "This title is already " + (status.Status ?? "requested").ToLowerInvariant() + ".", status.Status);
            }

            var resp = client.CreateRequest(match.SeerrUserId, mediaType, tmdb, seasons);
            if (resp.Status >= 200 && resp.Status < 300)
            {
                act.Result = "Requested";
                act.Detail = "Sent as " + (match.SeerrUserName ?? match.SeerrUserId) + " (" + match.How + ").";
                Store().Add(act);
                return new RequestResultDto { Ok = true, Result = act.Result, Detail = act.Detail, Status = DisplayStatus.Requested, Activity = act };
            }

            var err = string.IsNullOrWhiteSpace(resp.Error) ? ("Seerr returned HTTP " + resp.Status + ".") : resp.Error;
            return Fail(act, "Failed", err, status.Status);
        }

        public object Get(GetSeerrActivity r)
        {
            return new ActivityListDto { Items = Store().List() };
        }

        public object Get(GetSeerrSettings r) => ToSettings(Config());

        public object Post(PostSeerrSettings r)
        {
            r = ReadBody(r) ?? r;
            var cfg = Config();
            if (r == null) return ToSettings(cfg);
            if (r.Enabled != null) cfg.Enabled = r.Enabled.Value;
            if (r.SeerrUrl != null)
            {
                var err = SeerrClient.ValidateUrl(r.SeerrUrl);
                if (err != null) throw new ArgumentException(err);
                cfg.SeerrUrl = SeerrClient.NormalizeUrl(r.SeerrUrl);
            }
            if (r.ApiKey != null) cfg.ApiKey = ApiKeyGuard.ResolvePostedKey(r.ApiKey, cfg.ApiKey);
            if (r.VisibilityMode != null) cfg.VisibilityMode = NormalizeMode(r.VisibilityMode);
            if (r.AllowedUserIds != null) cfg.AllowedUserIds = r.AllowedUserIds;
            if (r.AllowedUserNames != null) cfg.AllowedUserNames = r.AllowedUserNames;
            if (r.AllowedLibraryIds != null) cfg.AllowedLibraryIds = r.AllowedLibraryIds;
            if (r.UserMaps != null) cfg.UserMaps = SanitizeMaps(r.UserMaps);
            Plugin.Instance.UpdateConfiguration(cfg);
            return ToSettings(Config());
        }

        public object Post(PostSeerrTestConnection r)
        {
            r = ReadBody(r) ?? r;
            var cfg = Config();
            var url = r != null && !string.IsNullOrWhiteSpace(r.SeerrUrl) ? r.SeerrUrl : cfg.SeerrUrl;
            var err = SeerrClient.ValidateUrl(url);
            if (err != null) return new TestConnectionDto { Ok = false, Message = err };
            var key = r != null && !ApiKeyGuard.IsMaskedOrEmpty(r.ApiKey) ? r.ApiKey.Trim() : cfg.ApiKey;
            var client = MakeClient(new PluginConfiguration { SeerrUrl = url, ApiKey = key });
            var status = client.GetStatus();
            var version = client.StatusVersion(status);
            if (status.Status != 200)
            {
                return new TestConnectionDto
                {
                    Ok = false,
                    Message = string.IsNullOrWhiteSpace(status.Error) ? "Could not reach Seerr at that URL." : status.Error
                };
            }
            var dto = new TestConnectionDto { Ok = true, Version = version, Message = "Reached Seerr" + (string.IsNullOrEmpty(version) ? "." : " " + version + ".") };
            if (string.IsNullOrEmpty(key))
            {
                dto.Message += " No API key is set, so the key was not checked.";
                return dto;
            }
            var me = client.GetMe();
            dto.KeyOk = me != null;
            dto.Message += dto.KeyOk
                ? " API key is valid" + (string.IsNullOrEmpty(me.DisplayName) ? "." : " (" + me.DisplayName + ").")
                : " The URL is reachable, but the API key was rejected.";
            dto.Ok = dto.KeyOk;
            return dto;
        }

        public object Get(GetSeerrPeople r)
        {
            var cfg = Config();
            var dto = new PeopleDto();
            if (UserManager != null)
            {
                foreach (var u in UserManager.Users)
                {
                    if (u == null) continue;
                    dto.EmbyUsers.Add(new EmbyUserRow
                    {
                        Id = u.Id.ToString(),
                        Name = u.Name,
                        IsAdmin = IsAdmin(u)
                    });
                }
            }
            if (!IsConfigured(cfg))
            {
                dto.Error = Eligibility.NotConfiguredMessage;
                return dto;
            }
            try
            {
                var client = MakeClient(cfg);
                dto.SeerrUsers = client.ListUsers();
            }
            catch (Exception ex)
            {
                dto.Error = ApiKeyGuard.Sanitize(ex.Message, cfg.ApiKey);
            }
            foreach (var row in dto.EmbyUsers)
            {
                var m = UserMatcher.Match(cfg, row.Id, row.Name, dto.SeerrUsers);
                if (!m.Matched) continue;
                row.SeerrUserId = m.SeerrUserId;
                row.SeerrUserName = m.SeerrUserName;
                row.How = m.How;
            }
            return dto;
        }

        public object Get(GetSeerrLibraries r)
        {
            var dto = new LibrariesDto();
            if (Library == null) return dto;
            try
            {
                var folders = Library.GetVirtualFolders();
                if (folders != null) foreach (var vf in folders)
                {
                    if (vf == null) continue;
                    dto.Items.Add(new LibraryRow { Id = vf.ItemId, Name = vf.Name, Type = vf.CollectionType ?? "mixed" });
                }
            }
            catch { /* older servers */ }
            try
            {
                var channels = Library.GetItemList(new InternalItemsQuery { IncludeItemTypes = new[] { "Channel" }, Recursive = false }) ?? Array.Empty<BaseItem>();
                foreach (var ch in channels)
                {
                    if (ch == null) continue;
                    var id = ch.Id.ToString();
                    if (dto.Items.Any(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase))) continue;
                    dto.Items.Add(new LibraryRow { Id = id, Name = ch.Name, Type = "Channel" });
                }
            }
            catch { /* optional */ }
            return dto;
        }

        ItemStatusDto BuildStatus(PluginConfiguration cfg, User user, RequestItem item)
        {
            var dto = new ItemStatusDto
            {
                Title = item != null ? item.Name : null,
                Year = item != null ? item.Year : null,
                ItemType = item != null ? item.Type : null,
                MediaType = Eligibility.MediaTypeOf(item),
                TmdbId = item != null ? item.Tmdb : null,
                TvdbId = item != null ? item.Tvdb : null,
                SuggestedSeason = item != null ? item.SeasonNumber : null,
                Seasons = new List<SeerrSeasonInfo>()
            };

            var isAdmin = IsAdmin(user);
            var userId = user != null ? user.Id.ToString() : null;
            var userName = user != null ? user.Name : null;

            if (cfg == null || !cfg.Enabled)
                return Hide(dto, Eligibility.DisabledMessage);
            if (user == null || !Eligibility.UserCanSee(cfg, userId, userName, isAdmin))
                return Hide(dto, Eligibility.NoPermissionMessage);
            if (!Eligibility.ItemEligible(item))
                return Hide(dto, Eligibility.NotEligibleMessage);
            if (!Eligibility.LibraryAllowed(cfg, item.LibraryId))
                return Hide(dto, Eligibility.LibraryMessage);
            if (!IsConfigured(cfg))
            {
                dto.Visible = true;
                dto.CanRequest = false;
                dto.Message = Eligibility.NotConfiguredMessage;
                return dto;
            }

            dto.Visible = true;
            var client = MakeClient(cfg);
            var users = SafeUsers(client);
            var match = UserMatcher.Match(cfg, userId, userName, users);
            if (!match.Matched)
            {
                dto.CanRequest = false;
                dto.Message = match.Message ?? Eligibility.UnmatchedMessage;
                return dto;
            }
            dto.SeerrUserName = match.SeerrUserName;
            dto.How = match.How;

            if (!Eligibility.HasProviderId(item) && string.IsNullOrWhiteSpace(item.Name))
            {
                dto.CanRequest = false;
                dto.Message = Eligibility.NoIdMessage;
                return dto;
            }

            var media = client.Lookup(item);
            if (media == null)
            {
                dto.Status = DisplayStatus.None;
                dto.CanRequest = Eligibility.HasProviderId(item) || !string.IsNullOrWhiteSpace(item.Name);
                if (!dto.CanRequest) dto.Message = Eligibility.NoIdMessage;
                else if (!TryInt(dto.TmdbId, out _))
                    dto.Message = "Seerr did not find this title. You can still try, or add a TMDb id on the item.";
                return dto;
            }

            if (media.TmdbId != null) dto.TmdbId = media.TmdbId.ToString();
            if (media.TvdbId != null) dto.TvdbId = media.TvdbId.ToString();
            if (!string.IsNullOrWhiteSpace(media.Title)) dto.Title = media.Title;
            if (media.Year != null) dto.Year = media.Year;
            dto.MediaType = media.MediaType ?? dto.MediaType;
            dto.Status = media.Display ?? DisplayStatus.None;
            dto.Seasons = media.Seasons ?? new List<SeerrSeasonInfo>();

            var isTv = dto.MediaType == "tv";
            var suggested = new List<int>();
            if (dto.SuggestedSeason != null) suggested.Add(dto.SuggestedSeason.Value);
            dto.CanRequest = StatusMapper.CanRequest(dto.Status, isTv, dto.Seasons, isTv && suggested.Count == 0, suggested);
            if (!dto.CanRequest)
            {
                if (dto.Status == DisplayStatus.Available) dto.Message = "This title is already available in Seerr.";
                else if (dto.Status == DisplayStatus.Pending) dto.Message = "A request is already pending approval in Seerr.";
                else if (dto.Status == DisplayStatus.Requested) dto.Message = "This title has already been requested.";
                else if (dto.Status == DisplayStatus.Blocked) dto.Message = "This title is blocklisted in Seerr.";
                else if (dto.Status == DisplayStatus.Partial) dto.Message = "Every season is already requested or available.";
            }
            return dto;
        }

        static ItemStatusDto Hide(ItemStatusDto dto, string message)
        {
            dto.Visible = false;
            dto.CanRequest = false;
            dto.Message = message;
            return dto;
        }

        RequestResultDto Fail(ActivityEntry act, string result, string detail, string status)
        {
            act.Result = result;
            act.Detail = detail;
            Store().Add(act);
            return new RequestResultDto { Ok = false, Result = result, Detail = detail, Status = status, Activity = act };
        }

        ActivityEntry NewActivity(User user, RequestItem item, string seasons)
        {
            return new ActivityEntry
            {
                EmbyUserId = user != null ? user.Id.ToString() : null,
                EmbyUserName = user != null ? user.Name : null,
                Title = item != null ? item.Name : null,
                Year = item != null ? item.Year : null,
                MediaType = Eligibility.MediaTypeOf(item),
                TmdbId = item != null ? item.Tmdb : null,
                TvdbId = item != null ? item.Tvdb : null,
                Seasons = seasons,
                ItemId = item != null ? item.Id : null
            };
        }

        RequestItem Describe(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || Library == null) return null;
            BaseItem item = null;
            try { item = Library.GetItemById(ParseId(id)); } catch { }
            if (item == null) return null;
            return FromBaseItem(item);
        }

        internal static RequestItem FromBaseItem(BaseItem item)
        {
            if (item == null) return null;
            var series = item as Series;
            var season = item as Season;
            var owner = season != null ? season.Series : null;
            var src = (BaseItem)owner ?? item;
            var ri = new RequestItem
            {
                Id = item.Id.ToString(),
                Name = src.Name ?? item.Name,
                Type = item.GetClientTypeName() ?? item.GetType().Name,
                ExtraType = ExtraTypeName(item),
                Path = item.Path,
                LocationType = item.LocationType.ToString(),
                MediaSourceCount = MediaCount(item),
                Year = src.ProductionYear,
                Tmdb = Pid(src, "Tmdb", "TheMovieDb", "TheMoviesDb"),
                Tvdb = Pid(src, "Tvdb", "TheTVDB", "TvdbId"),
                Imdb = Pid(src, "Imdb", "IMDB"),
                LibraryId = LibraryIdOf(item)
            };
            if (season != null)
            {
                ri.Type = "Season";
                ri.SeriesId = owner != null ? owner.Id.ToString() : null;
                ri.SeasonNumber = season.IndexNumber;
                if (owner != null)
                {
                    ri.Path = owner.Path;
                    ri.LocationType = owner.LocationType.ToString();
                    ri.MediaSourceCount = MediaCount(owner);
                }
            }
            return ri;
        }

        static string ExtraTypeName(BaseItem item)
        {
            try
            {
                var et = item.ExtraType;
                return et != null ? et.ToString() : null;
            }
            catch { return null; }
        }

        static int MediaCount(BaseItem item)
        {
            if (item == null) return 0;
            if (!string.IsNullOrWhiteSpace(item.Path) && item.LocationType != LocationType.Virtual) return 1;
            return 0;
        }

        static string LibraryIdOf(BaseItem item)
        {
            var walk = item;
            for (var i = 0; i < 12 && walk != null; i++)
            {
                var name = walk.GetType().Name;
                var client = walk.GetClientTypeName() ?? "";
                if (string.Equals(client, "CollectionFolder", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(client, "Channel", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(client, "UserView", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(name, "CollectionFolder", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(name, "Channel", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(name, "AggregateFolder", StringComparison.OrdinalIgnoreCase))
                    return walk.Id.ToString();
                walk = walk.GetParent();
            }
            return item != null ? item.Id.ToString() : null;
        }

        static string Pid(BaseItem item, params string[] keys)
        {
            if (item == null || item.ProviderIds == null) return null;
            foreach (var k in keys)
            {
                if (item.ProviderIds.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v))
                    return v.Trim();
            }
            return null;
        }

        static Guid ParseId(string id)
        {
            Guid.TryParse(id, out var g);
            return g;
        }

        PluginConfiguration Config()
        {
            return Plugin.Instance != null ? Plugin.Instance.Configuration ?? new PluginConfiguration() : new PluginConfiguration();
        }

        User CurrentUser()
        {
            try
            {
                if (Auth == null || Request == null) return null;
                return Auth.GetAuthorizationInfo(Request)?.User;
            }
            catch { return null; }
        }

        static bool IsAdmin(User user)
        {
            try { return user != null && user.Policy != null && user.Policy.IsAdministrator; }
            catch { return false; }
        }

        SeerrClient MakeClient(PluginConfiguration cfg)
        {
            if (ClientFactory != null) return ClientFactory(cfg, Logger());
            return new SeerrClient(cfg.SeerrUrl, cfg.ApiKey, new HttpSeerrTransport(), line => Logger()?.Info("Seerr Requests: {0}", line));
        }

        ActivityStore Store()
        {
            if (StoreFactory != null) return StoreFactory();
            var dir = Plugin.Instance != null ? Plugin.Instance.DataDirectory : System.IO.Path.Combine(System.IO.Path.GetTempPath(), "claw-seerrrequests");
            return new ActivityStore(dir);
        }

        List<SeerrUserInfo> SafeUsers(SeerrClient client)
        {
            try { return client.ListUsers() ?? new List<SeerrUserInfo>(); }
            catch (Exception ex)
            {
                Logger()?.Warn("Seerr Requests: could not list users: {0}", ApiKeyGuard.Sanitize(ex.Message, Config().ApiKey));
                return new List<SeerrUserInfo>();
            }
        }

        ILogger Logger()
        {
            try { return LogManager != null ? LogManager.GetLogger("SeerrRequests") : null; }
            catch { return null; }
        }

        static bool IsConfigured(PluginConfiguration cfg)
        {
            return cfg != null && !string.IsNullOrWhiteSpace(SeerrClient.NormalizeUrl(cfg.SeerrUrl)) && !string.IsNullOrWhiteSpace(cfg.ApiKey);
        }

        static string VersionString()
        {
            return Plugin.Instance != null ? Plugin.Instance.Version.ToString() : "1.0.0.0";
        }

        SettingsDto ToSettings(PluginConfiguration cfg)
        {
            return new SettingsDto
            {
                Enabled = cfg.Enabled,
                SeerrUrl = string.IsNullOrWhiteSpace(cfg.SeerrUrl) ? "https://requests.christopherlaw.com" : cfg.SeerrUrl,
                ApiKey = ApiKeyGuard.Mask(cfg.ApiKey),
                ApiKeySet = !string.IsNullOrEmpty(cfg.ApiKey),
                VisibilityMode = NormalizeMode(cfg.VisibilityMode),
                AllowedUserIds = cfg.AllowedUserIds ?? Array.Empty<string>(),
                AllowedUserNames = cfg.AllowedUserNames ?? Array.Empty<string>(),
                AllowedLibraryIds = cfg.AllowedLibraryIds ?? Array.Empty<string>(),
                UserMaps = cfg.UserMaps ?? Array.Empty<UserMapEntry>(),
                Version = VersionString(),
                Script = InjectEntryPoint.ScriptFileName
            };
        }

        static string NormalizeMode(string mode)
        {
            var m = (mode ?? "all").Trim().ToLowerInvariant();
            return m == "admins" || m == "allowlist" ? m : "all";
        }

        static UserMapEntry[] SanitizeMaps(UserMapEntry[] maps)
        {
            if (maps == null) return Array.Empty<UserMapEntry>();
            var list = new List<UserMapEntry>();
            foreach (var m in maps)
            {
                if (m == null || string.IsNullOrWhiteSpace(m.EmbyUserId) || string.IsNullOrWhiteSpace(m.SeerrUserId)) continue;
                list.Add(new UserMapEntry
                {
                    EmbyUserId = m.EmbyUserId.Trim(),
                    EmbyUserName = m.EmbyUserName,
                    SeerrUserId = m.SeerrUserId.Trim(),
                    SeerrUserName = m.SeerrUserName,
                    Mode = "manual"
                });
            }
            return list.ToArray();
        }

        static (bool All, List<int> Numbers) ParseSeasons(string seasons)
        {
            if (string.IsNullOrWhiteSpace(seasons) || string.Equals(seasons.Trim(), "all", StringComparison.OrdinalIgnoreCase))
                return (true, new List<int>());
            var nums = new List<int>();
            foreach (var p in seasons.Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries))
                if (int.TryParse(p.Trim(), out var n) && n > 0 && !nums.Contains(n)) nums.Add(n);
            return (false, nums);
        }

        static bool TryInt(string s, out int n)
        {
            n = 0;
            return !string.IsNullOrWhiteSpace(s) && int.TryParse(s.Trim(), out n);
        }
    }
}
