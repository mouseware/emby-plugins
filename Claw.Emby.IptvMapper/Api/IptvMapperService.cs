using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Drawing;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.LiveTv;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.LiveTv;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Model.Services;

namespace Claw.Emby.IptvMapper.Api
{
    [Route("/IptvMapper/Channels", "GET", Summary = "IPTV Channel Mapper: tuner channels joined with Emby TvChannel items (read-only, no stream URLs)")]
    [Authenticated(Roles = "Admin")]
    public class GetIptvMapperChannels : IReturn<IptvMapperChannelsResult>
    {
    }

    [Route("/IptvMapper/Ping", "GET", Summary = "IPTV Channel Mapper: service presence check")]
    [Authenticated(Roles = "Admin")]
    public class GetIptvMapperPing : IReturn<IptvMapperPingResult>
    {
    }

    public class IptvMapperPingResult
    {
        public string Plugin { get; set; }
        public string Version { get; set; }
    }

    public class IptvMapperChannelsResult
    {
        public string GeneratedUtc { get; set; }
        public int SchemaVersion { get; set; } = 1;
        public List<IptvMapperTuner> Tuners { get; set; } = new List<IptvMapperTuner>();
        public List<IptvMapperRow> Rows { get; set; } = new List<IptvMapperRow>();
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class IptvMapperTuner
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public int EntryCount { get; set; }
        public int ChannelCount { get; set; }
        public bool CacheFound { get; set; }
        public string CacheError { get; set; }
    }

    public class IptvMapperRow
    {
        public string Key { get; set; }
        public string ItemId { get; set; }
        public string ManagementId { get; set; }
        public string TunerHostId { get; set; }
        public string TunerName { get; set; }
        public string TvgId { get; set; }
        public string M3uName { get; set; }
        public string M3uNumber { get; set; }
        public string M3uGroup { get; set; }
        /// <summary>Raw M3U group-title tags (plus tuner AdditionalTags) from the tuner cache.</summary>
        public string[] M3uTags { get; set; } = Array.Empty<string>();
        /// <summary>Current Tags on the TvChannel item (the effective group; editable, lock-aware via MetadataFields.Tags).</summary>
        public string[] ItemTags { get; set; } = Array.Empty<string>();
        public string M3uLogoUrl { get; set; }
        public bool M3uLogoHidden { get; set; }
        public string Name { get; set; }
        public string ChannelNumber { get; set; }
        public string[] LockedFields { get; set; } = Array.Empty<string>();
        public bool LockData { get; set; }
        public bool HasPrimaryImage { get; set; }
        public string PrimaryImageTag { get; set; }
        public bool Disabled { get; set; }
        public int SortIndex { get; set; }
        /// <summary>Explicit ChannelOptions value: null = auto-match, "none" = no guide.</summary>
        public string ListingsProviderId { get; set; }
        public string ListingsChannelId { get; set; }
        public bool HasChannelOptions { get; set; }
        public bool InLibrary { get; set; }
        public bool InTunerCache { get; set; }
    }

    /// <summary>Subset of the tuner cache entry. Path (stream URL) is read only to compare hosts; never returned.</summary>
    public class TunerCacheEntry
    {
        public string Id { get; set; }
        public string TunerHostId { get; set; }
        public string TunerChannelId { get; set; }
        public string TvgId { get; set; }
        public string Name { get; set; }
        public string Number { get; set; }
        public string ImageUrl { get; set; }
        public string[] Tags { get; set; }
        public string Path { get; set; }
    }

    public class IptvMapperService : IService, IRequiresRequest
    {
        private readonly ILibraryManager _libraryManager;
        private readonly IServerConfigurationManager _config;
        private readonly IJsonSerializer _json;
        private readonly IImageProcessor _imageProcessor;
        private readonly ILogger _logger;

        public IptvMapperService(ILibraryManager libraryManager, IServerConfigurationManager config, IJsonSerializer json, IImageProcessor imageProcessor, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _config = config;
            _json = json;
            _imageProcessor = imageProcessor;
            _logger = logManager.GetLogger("IptvMapper");
        }

        public IRequest Request { get; set; }

        public object Get(GetIptvMapperPing request)
        {
            return new IptvMapperPingResult
            {
                Plugin = "Claw.Emby.IptvMapper",
                Version = typeof(IptvMapperService).Assembly.GetName().Version?.ToString()
            };
        }

        public object Get(GetIptvMapperChannels request)
        {
            var result = new IptvMapperChannelsResult { GeneratedUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };

            LiveTvOptions options;
            try
            {
                options = (LiveTvOptions)_config.GetConfiguration("livetv");
            }
            catch (Exception ex)
            {
                _logger.ErrorException("IptvMapper: cannot read livetv configuration", ex);
                result.Warnings.Add("Cannot read Live TV configuration: " + ex.Message);
                return result;
            }

            var channelOptions = options?.ChannelOptions ?? Array.Empty<ChannelOptions>();
            var optionsById = new Dictionary<string, ChannelOptions>(StringComparer.OrdinalIgnoreCase);
            foreach (var o in channelOptions)
            {
                if (o != null && !string.IsNullOrEmpty(o.Id) && !optionsById.ContainsKey(o.Id))
                {
                    optionsById[o.Id] = o;
                }
            }

            // Library TvChannel items keyed by ExternalId (= tuner channel id).
            var itemsByExternalId = new Dictionary<string, LiveTvChannel>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var items = _libraryManager.GetItemList(new InternalItemsQuery
                {
                    IncludeItemTypes = new[] { typeof(LiveTvChannel).Name },
                    Recursive = true
                });
                foreach (var item in items.OfType<LiveTvChannel>())
                {
                    if (!string.IsNullOrEmpty(item.ExternalId) && !itemsByExternalId.ContainsKey(item.ExternalId))
                    {
                        itemsByExternalId[item.ExternalId] = item;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.ErrorException("IptvMapper: cannot query TvChannel items", ex);
                result.Warnings.Add("Cannot query Live TV channel items: " + ex.Message);
            }

            var usedExternalIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var keyCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var index = 0;

            foreach (var tuner in options?.TunerHosts ?? Array.Empty<TunerHostInfo>())
            {
                if (tuner == null || string.IsNullOrEmpty(tuner.Id))
                {
                    continue;
                }

                var tunerInfo = new IptvMapperTuner
                {
                    Id = tuner.Id,
                    Type = tuner.Type,
                    Name = string.IsNullOrWhiteSpace(tuner.FriendlyName)
                        ? (string.Equals(tuner.Type, "m3u", StringComparison.OrdinalIgnoreCase) ? "M3U" : tuner.Type)
                        : tuner.FriendlyName
                };
                result.Tuners.Add(tunerInfo);

                var entries = ReadTunerCache(tuner.Id, tunerInfo);
                tunerInfo.EntryCount = entries.Count;
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (var e in entries)
                {
                    if (e == null || string.IsNullOrEmpty(e.Id) || !seen.Add(e.Id))
                    {
                        continue; // duplicate ids collapse into one channel, first wins (same as Emby)
                    }

                    var managementId = tuner.Id + "_" + e.Id;
                    optionsById.TryGetValue(managementId, out var opt);
                    if (opt == null)
                    {
                        optionsById.TryGetValue(e.Id, out opt);
                    }

                    itemsByExternalId.TryGetValue(e.Id, out var item);
                    if (item != null)
                    {
                        usedExternalIds.Add(e.Id);
                    }

                    var tvg = !string.IsNullOrWhiteSpace(e.TvgId) ? e.TvgId.Trim() : (!string.IsNullOrWhiteSpace(e.TunerChannelId) ? e.TunerChannelId.Trim() : null);
                    var row = new IptvMapperRow
                    {
                        ManagementId = managementId,
                        TunerHostId = tuner.Id,
                        TunerName = tunerInfo.Name,
                        TvgId = tvg,
                        M3uName = e.Name,
                        M3uNumber = e.Number,
                        M3uGroup = e.Tags != null && e.Tags.Length > 0 ? string.Join(", ", e.Tags) : null,
                        M3uTags = e.Tags ?? Array.Empty<string>(),
                        Disabled = opt != null && opt.Disabled,
                        HasChannelOptions = opt != null,
                        ListingsProviderId = opt?.ListingsProviderId,
                        ListingsChannelId = opt?.ListingsChannelId,
                        InTunerCache = true
                    };
                    SetLogo(row, e);

                    var sortIndex = opt != null && opt.SortIndexNumber >= 0 ? opt.SortIndexNumber : index;
                    FillFromItem(row, item, managementId);
                    row.SortIndex = item?.SortIndexNumber ?? sortIndex;

                    row.Key = MakeUniqueKey(BuildKey(tuner.Id, tvg, e.Name), keyCounts);
                    result.Rows.Add(row);
                    tunerInfo.ChannelCount++;
                    index++;
                }
            }

            // Library channels whose tuner cache entry is missing (cache unreadable, or orphaned item).
            foreach (var pair in itemsByExternalId)
            {
                if (usedExternalIds.Contains(pair.Key))
                {
                    continue;
                }

                var item = pair.Value;
                var row = new IptvMapperRow
                {
                    TunerName = "(unknown tuner)",
                    M3uName = item.Name,
                    M3uNumber = item.Number,
                    InTunerCache = false
                };
                FillFromItem(row, item, null);
                row.SortIndex = item.SortIndexNumber ?? index++;
                row.Key = MakeUniqueKey(BuildKey("unknown", null, item.Name), keyCounts);
                result.Rows.Add(row);
            }

            result.Rows = result.Rows.OrderBy(r => r.SortIndex).ToList();
            return result;
        }

        private void FillFromItem(IptvMapperRow row, LiveTvChannel item, string managementId)
        {
            if (item == null)
            {
                row.ItemId = managementId; // Emby uses Id = ManagementId for disabled channels
                row.Name = row.M3uName;
                row.ChannelNumber = row.M3uNumber;
                row.InLibrary = false;
                return;
            }

            row.InLibrary = true;
            row.ItemId = item.GetClientId();
            row.Name = item.Name;
            row.ChannelNumber = item.Number;
            row.LockData = item.IsLocked;
            row.LockedFields = (item.LockedFields ?? Array.Empty<MetadataFields>()).Select(f => f.ToString()).ToArray();
            try
            {
                row.ItemTags = item.Tags ?? Array.Empty<string>();
            }
            catch (Exception ex)
            {
                _logger.Debug("IptvMapper: tags failed for {0}: {1}", row.ItemId, ex.Message);
            }
            try
            {
                var img = item.GetImageInfo(ImageType.Primary, 0);
                row.HasPrimaryImage = img != null;
                if (img != null)
                {
                    row.PrimaryImageTag = _imageProcessor.GetImageCacheTag(item, img);
                }
            }
            catch (Exception ex)
            {
                _logger.Debug("IptvMapper: image tag failed for {0}: {1}", row.ItemId, ex.Message);
            }
        }

        private List<TunerCacheEntry> ReadTunerCache(string tunerId, IptvMapperTuner info)
        {
            var path = Path.Combine(_config.ApplicationPaths.DataPath, "livetv", "tuner_" + tunerId + "_channels");
            if (!File.Exists(path))
            {
                info.CacheFound = false;
                info.CacheError = "Tuner channel cache not found (refresh guide data to create it).";
                return new List<TunerCacheEntry>();
            }

            info.CacheFound = true;
            try
            {
                return _json.DeserializeFromFile<List<TunerCacheEntry>>(path) ?? new List<TunerCacheEntry>();
            }
            catch (Exception ex)
            {
                info.CacheError = "Cannot parse tuner channel cache: " + ex.Message;
                _logger.ErrorException("IptvMapper: cannot parse tuner cache for tuner {0}", ex, tunerId);
                return new List<TunerCacheEntry>();
            }
        }

        /// <summary>Returns the tvg-logo URL unless it could carry credentials (userinfo, or same host as the stream URL).</summary>
        private static void SetLogo(IptvMapperRow row, TunerCacheEntry e)
        {
            if (string.IsNullOrWhiteSpace(e.ImageUrl))
            {
                return;
            }

            if (!Uri.TryCreate(e.ImageUrl.Trim(), UriKind.Absolute, out var logo) ||
                (logo.Scheme != Uri.UriSchemeHttp && logo.Scheme != Uri.UriSchemeHttps))
            {
                row.M3uLogoHidden = true;
                return;
            }

            if (!string.IsNullOrEmpty(logo.UserInfo))
            {
                row.M3uLogoHidden = true;
                return;
            }

            if (!string.IsNullOrEmpty(e.Path) && Uri.TryCreate(e.Path, UriKind.Absolute, out var stream) &&
                string.Equals(stream.Host, logo.Host, StringComparison.OrdinalIgnoreCase))
            {
                row.M3uLogoHidden = true;
                return;
            }

            row.M3uLogoUrl = logo.AbsoluteUri;
        }

        internal static string BuildKey(string tunerHostId, string tvgId, string name)
        {
            if (!string.IsNullOrWhiteSpace(tvgId))
            {
                return tunerHostId + "|tvg:" + tvgId.Trim().ToLowerInvariant();
            }

            return tunerHostId + "|name:" + NormalizeName(name);
        }

        internal static string NormalizeName(string name)
        {
            var sb = new StringBuilder();
            foreach (var ch in (name ?? string.Empty).Normalize(NormalizationForm.FormKC))
            {
                if (char.IsLetterOrDigit(ch))
                {
                    sb.Append(char.ToLowerInvariant(ch));
                }
            }

            return sb.ToString();
        }

        private static string MakeUniqueKey(string key, Dictionary<string, int> counts)
        {
            if (counts.TryGetValue(key, out var n))
            {
                n++;
                counts[key] = n;
                return key + "#" + n.ToString(CultureInfo.InvariantCulture);
            }

            counts[key] = 1;
            return key;
        }
    }
}
