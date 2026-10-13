using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Claw.Emby.IptvMapper.Api;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.LiveTv;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.LiveTv;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Serialization;

namespace Claw.Emby.IptvMapper.Guide
{
    /// <summary>
    /// "Channel Name Guide": a listings provider that gives every tuner channel one guide program per local day
    /// (midnight to midnight, server time zone), titled with the channel's CURRENT M3U name.
    /// Discovered by Emby like XmlTV / Emby Guide Data: any concrete IListingsProvider in a plugin assembly is
    /// instantiated by ApplicationHost (GetExports&lt;IListingsProvider&gt;) and handed to LiveTvManager.AddParts.
    /// Opt-in per channel: guide channel ids/names are deliberately NOT equal to the tuner channel id/name/number,
    /// so Emby's auto-matching never picks this provider; channels are mapped explicitly (mapper page).
    /// </summary>
    public class ChannelNameGuideProvider : IListingsProvider
    {
        public const string ProviderType = "clawdummy";
        public const string ProviderName = "Channel Name Guide";
        public const string ChannelIdPrefix = "cng_";
        public const string ChannelNameSuffix = " (name guide)";

        private readonly IServerConfigurationManager _config;
        private readonly IJsonSerializer _json;
        private readonly ILibraryManager _libraryManager;
        private readonly ILogger _logger;
        private readonly object _cacheLock = new object();
        private readonly Dictionary<string, CachedTuner> _tunerCache = new Dictionary<string, CachedTuner>(StringComparer.OrdinalIgnoreCase);

        private sealed class CachedTuner
        {
            public DateTime FileTimeUtc;
            public long Length;
            public Dictionary<string, TunerCacheEntry> ById = new Dictionary<string, TunerCacheEntry>(StringComparer.OrdinalIgnoreCase);
            public List<TunerCacheEntry> Ordered = new List<TunerCacheEntry>();
        }

        public ChannelNameGuideProvider(IServerConfigurationManager config, IJsonSerializer json, ILibraryManager libraryManager, ILogManager logManager)
        {
            _config = config;
            _json = json;
            _libraryManager = libraryManager;
            _logger = logManager.GetLogger("IptvMapper.NameGuide");
        }

        public string Name => ProviderName;

        public string Type => ProviderType;

        /// <summary>Emby's "Add guide provider" dialog navigates here; the mapper page has the Enable button.</summary>
        public string SetupUrl => BasePlugin.GetPluginPageUrl("IptvMapper");

        public static string ListingChannelId(string managementId) => ChannelIdPrefix + managementId;

        public Task Validate(ListingsProviderInfo info, bool validateLogin, bool validateListings) => Task.CompletedTask;

        public Task<List<NameIdPair>> GetLineups(ListingsProviderInfo info, string country, string location, CancellationToken cancellationToken)
            => Task.FromResult(new List<NameIdPair>());

        public Task<List<ChannelInfo>> GetChannels(ListingsProviderInfo info, CancellationToken cancellationToken)
        {
            var list = new List<ChannelInfo>();
            foreach (var tuner in GetTuners())
            {
                if (info != null && !info.EnableAllTuners && !(info.EnabledTuners ?? Array.Empty<string>()).Contains(tuner.Id, StringComparer.OrdinalIgnoreCase))
                {
                    continue;
                }

                foreach (var e in GetTunerEntries(tuner.Id).Ordered)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    list.Add(new ChannelInfo
                    {
                        Id = ListingChannelId(tuner.Id + "_" + e.Id),
                        // Suffix so Emby's name auto-matching (normalized name) can never select this provider.
                        Name = (string.IsNullOrWhiteSpace(e.Name) ? e.Id : e.Name.Trim()) + ChannelNameSuffix,
                        AlternateNames = Array.Empty<string>(),
                        // Number intentionally empty: avoids number auto-matching (AllowMappingByNumber).
                        ChannelType = ChannelType.TV
                    });
                }
            }

            _logger.Info("Channel Name Guide: {0} guide channels", list.Count);
            return Task.FromResult(list);
        }

        public Task<List<ProgramInfo>> GetProgramsAsync(ListingsProviderInfo info, string channelId, DateTimeOffset startDateUtc, DateTimeOffset endDateUtc, CancellationToken cancellationToken)
        {
            var programs = new List<ProgramInfo>();
            if (string.IsNullOrEmpty(channelId) || !channelId.StartsWith(ChannelIdPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult(programs);
            }

            var managementId = channelId.Substring(ChannelIdPrefix.Length);
            var sep = managementId.IndexOf('_');
            string title = null;
            string[] genres = Array.Empty<string>();
            if (sep > 0)
            {
                var tunerId = managementId.Substring(0, sep);
                var entryId = managementId.Substring(sep + 1);
                if (GetTunerEntries(tunerId).ById.TryGetValue(entryId, out var e))
                {
                    title = e.Name;
                    genres = (e.Tags ?? Array.Empty<string>()).Where(t => !string.IsNullOrWhiteSpace(t)).ToArray();
                }

                if (string.IsNullOrWhiteSpace(title))
                {
                    title = GetLibraryChannelName(entryId);
                }
            }

            title = string.IsNullOrWhiteSpace(title) ? "Live TV" : title.Trim();
            foreach (var b in DayBlockGenerator.Build(channelId, startDateUtc, endDateUtc, GetTimeZone()))
            {
                programs.Add(new ProgramInfo
                {
                    Id = b.Id,
                    ChannelId = channelId,
                    Name = title,
                    Overview = null,
                    StartDate = b.StartUtc,
                    EndDate = b.EndUtc,
                    Genres = genres.ToList(),
                    IsLive = false,
                    IsSeries = false,
                    IsMovie = false,
                    IsNew = false,
                    IsRepeat = false
                });
            }

            return Task.FromResult(programs);
        }

        private static TimeZoneInfo GetTimeZone() => TimeZoneInfo.Local;

        private IEnumerable<TunerHostInfo> GetTuners()
        {
            try
            {
                var options = (LiveTvOptions)_config.GetConfiguration("livetv");
                return (options?.TunerHosts ?? Array.Empty<TunerHostInfo>()).Where(t => t != null && !string.IsNullOrEmpty(t.Id)).ToList();
            }
            catch (Exception ex)
            {
                _logger.ErrorException("Channel Name Guide: cannot read livetv configuration", ex);
                return Array.Empty<TunerHostInfo>();
            }
        }

        /// <summary>Tuner channel cache written by Emby on every guide refresh (re-read when the file changes).</summary>
        private CachedTuner GetTunerEntries(string tunerId)
        {
            var path = Path.Combine(_config.ApplicationPaths.DataPath, "livetv", "tuner_" + tunerId + "_channels");
            lock (_cacheLock)
            {
                _tunerCache.TryGetValue(tunerId, out var cached);
                try
                {
                    var fi = new FileInfo(path);
                    if (!fi.Exists)
                    {
                        return cached ?? new CachedTuner();
                    }

                    if (cached != null && cached.FileTimeUtc == fi.LastWriteTimeUtc && cached.Length == fi.Length)
                    {
                        return cached;
                    }

                    var entries = _json.DeserializeFromFile<List<TunerCacheEntry>>(path) ?? new List<TunerCacheEntry>();
                    var fresh = new CachedTuner { FileTimeUtc = fi.LastWriteTimeUtc, Length = fi.Length };
                    foreach (var e in entries)
                    {
                        if (e == null || string.IsNullOrEmpty(e.Id) || fresh.ById.ContainsKey(e.Id)) continue;
                        e.Path = null; // never keep stream URLs around
                        fresh.ById[e.Id] = e;
                        fresh.Ordered.Add(e);
                    }

                    _tunerCache[tunerId] = fresh;
                    return fresh;
                }
                catch (Exception ex)
                {
                    _logger.ErrorException("Channel Name Guide: cannot read tuner cache {0}", ex, tunerId);
                    return cached ?? new CachedTuner();
                }
            }
        }

        private string GetLibraryChannelName(string externalId)
        {
            try
            {
                var item = _libraryManager.GetItemList(new InternalItemsQuery
                {
                    IncludeItemTypes = new[] { typeof(LiveTvChannel).Name },
                    Recursive = true
                }).OfType<LiveTvChannel>().FirstOrDefault(i => string.Equals(i.ExternalId, externalId, StringComparison.OrdinalIgnoreCase));
                return item?.Name;
            }
            catch (Exception ex)
            {
                _logger.Debug("Channel Name Guide: library lookup failed for {0}: {1}", externalId, ex.Message);
                return null;
            }
        }
    }
}
