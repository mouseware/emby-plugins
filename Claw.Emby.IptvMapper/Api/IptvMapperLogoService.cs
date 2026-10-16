using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.LiveTv;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Model.Services;

namespace Claw.Emby.IptvMapper.Api
{
    [Route("/IptvMapper/Logo", "GET", Summary = "IPTV Channel Mapper: a channel's current logo for the export (Emby's stored image, else a known logo URL), base64")]
    [Authenticated(Roles = "Admin")]
    public class GetIptvMapperLogo : IReturn<IptvMapperLogoResult>
    {
        /// <summary>TvChannel item id; its stored Primary image is used when present.</summary>
        public string ItemId { get; set; }
        /// <summary>Fallback logo URL. Only URLs the plugin already knows (tuner tvg-logo or an override) are fetched.</summary>
        public string Url { get; set; }
    }

    public class IptvMapperLogoResult
    {
        public bool Ok { get; set; }
        /// <summary>emby | url</summary>
        public string Source { get; set; }
        public string ContentType { get; set; }
        public string Base64 { get; set; }
        public long Bytes { get; set; }
        public string Error { get; set; }
    }

    /// <summary>Reads logos for "Include all logos" exports. Read-only: nothing on the server changes.</summary>
    public class IptvMapperLogoService : IService
    {
        internal const int MaxBytes = 5 * 1024 * 1024;
        internal static readonly TimeSpan UrlTimeout = TimeSpan.FromSeconds(15);
        private static readonly HttpClient Http = CreateClient();
        private static readonly SemaphoreSlim Downloads = new SemaphoreSlim(6, 6);
        private static readonly object KnownLock = new object();
        private static HashSet<string> _known;
        private static DateTime _knownAt;

        private readonly ILibraryManager _libraryManager;
        private readonly IServerConfigurationManager _config;
        private readonly IJsonSerializer _json;
        private readonly ILogger _logger;

        public IptvMapperLogoService(ILibraryManager libraryManager, IServerConfigurationManager config, IJsonSerializer json, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _config = config;
            _json = json;
            _logger = logManager.GetLogger("IptvMapper");
        }

        private static HttpClient CreateClient()
        {
            var c = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true, MaxAutomaticRedirections = 5 }) { Timeout = UrlTimeout };
            c.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Emby IPTV Channel Mapper logo export)");
            return c;
        }

        public async Task<object> Get(GetIptvMapperLogo request)
        {
            string embyError = null;
            if (!string.IsNullOrWhiteSpace(request.ItemId))
            {
                try
                {
                    var r = ReadItemImage(request.ItemId.Trim());
                    if (r != null) return r;
                }
                catch (Exception ex)
                {
                    embyError = "stored image: " + ex.Message;
                }
            }

            if (string.IsNullOrWhiteSpace(request.Url))
            {
                return Fail(embyError ?? "no logo");
            }

            if (!Uri.TryCreate(request.Url.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) || !string.IsNullOrEmpty(uri.UserInfo))
            {
                return Fail("not an http(s) URL");
            }

            if (!IsKnownUrl(uri.AbsoluteUri))
            {
                return Fail("URL is not a known channel logo");
            }

            await Downloads.WaitAsync().ConfigureAwait(false);
            try
            {
                return await Download(uri).ConfigureAwait(false);
            }
            finally
            {
                Downloads.Release();
            }
        }

        private IptvMapperLogoResult ReadItemImage(string itemId)
        {
            var item = _libraryManager.GetItemById(itemId);
            if (item == null) return null;
            var img = item.GetImageInfo(ImageType.Primary, 0);
            if (img == null || string.IsNullOrEmpty(img.Path)) return null;
            if (img.Path.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return null; // remote reference: fall back to the URL
            if (!File.Exists(img.Path)) throw new FileNotFoundException("file missing on disk");
            var len = new FileInfo(img.Path).Length;
            if (len == 0) throw new IOException("empty file");
            if (len > MaxBytes) throw new IOException("larger than 5 MB");
            var bytes = File.ReadAllBytes(img.Path);
            var type = LogoSniff.ImageType(bytes);
            if (type == null) throw new IOException("not an image");
            return new IptvMapperLogoResult { Ok = true, Source = "emby", ContentType = type, Base64 = Convert.ToBase64String(bytes), Bytes = bytes.Length };
        }

        private async Task<IptvMapperLogoResult> Download(Uri uri)
        {
            try
            {
                using (var cts = new CancellationTokenSource(UrlTimeout))
                using (var resp = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false))
                {
                    if (!resp.IsSuccessStatusCode) return Fail("HTTP " + (int)resp.StatusCode);
                    if (resp.Content.Headers.ContentLength > MaxBytes) return Fail("larger than 5 MB");
                    using (var s = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    using (var ms = new MemoryStream())
                    {
                        var buf = new byte[81920];
                        int n;
                        while ((n = await s.ReadAsync(buf, 0, buf.Length, cts.Token).ConfigureAwait(false)) > 0)
                        {
                            ms.Write(buf, 0, n);
                            if (ms.Length > MaxBytes) return Fail("larger than 5 MB");
                        }

                        var bytes = ms.ToArray();
                        if (bytes.Length == 0) return Fail("empty response");
                        var type = LogoSniff.ImageType(bytes);
                        if (type == null) return Fail("not an image (" + (resp.Content.Headers.ContentType?.MediaType ?? "unknown type") + ")");
                        return new IptvMapperLogoResult { Ok = true, Source = "url", ContentType = type, Base64 = Convert.ToBase64String(bytes), Bytes = bytes.Length };
                    }
                }
            }
            catch (OperationCanceledException)
            {
                return Fail("timed out after " + (int)UrlTimeout.TotalSeconds + " s");
            }
            catch (HttpRequestException ex)
            {
                return Fail(ex.InnerException?.Message ?? ex.Message);
            }
            catch (Exception ex)
            {
                _logger.Debug("IptvMapper: logo download {0} failed: {1}", uri.Host, ex.Message);
                return Fail(ex.Message);
            }
        }

        private static IptvMapperLogoResult Fail(string error) => new IptvMapperLogoResult { Ok = false, Error = error };

        /// <summary>tvg-logo URLs from the tuner caches plus override logo URLs (cached for a minute).</summary>
        private bool IsKnownUrl(string url)
        {
            lock (KnownLock)
            {
                if (_known == null || DateTime.UtcNow - _knownAt > TimeSpan.FromMinutes(1))
                {
                    _known = LoadKnown();
                    _knownAt = DateTime.UtcNow;
                }

                return _known.Contains(url);
            }
        }

        private HashSet<string> LoadKnown()
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            void Add(string u)
            {
                if (!string.IsNullOrWhiteSpace(u) && Uri.TryCreate(u.Trim(), UriKind.Absolute, out var x)) set.Add(x.AbsoluteUri);
            }

            try
            {
                var options = (LiveTvOptions)_config.GetConfiguration("livetv");
                foreach (var t in options?.TunerHosts ?? Array.Empty<TunerHostInfo>())
                {
                    if (t == null || string.IsNullOrEmpty(t.Id)) continue;
                    var path = Path.Combine(_config.ApplicationPaths.DataPath, "livetv", "tuner_" + t.Id + "_channels");
                    if (!File.Exists(path)) continue;
                    try
                    {
                        foreach (var e in _json.DeserializeFromFile<List<TunerCacheEntry>>(path) ?? new List<TunerCacheEntry>()) Add(e?.ImageUrl);
                    }
                    catch (Exception ex)
                    {
                        _logger.Debug("IptvMapper: tuner cache {0} unreadable for logo export: {1}", t.Id, ex.Message);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.Debug("IptvMapper: livetv config unreadable for logo export: {0}", ex.Message);
            }

            foreach (var o in Plugin.Instance?.Configuration?.Overrides ?? Array.Empty<Configuration.ChannelOverride>()) Add(o?.LogoUrl);
            return set;
        }
    }

    internal static class LogoSniff
    {
        /// <summary>Image MIME type from the first bytes, or null.</summary>
        internal static string ImageType(byte[] b)
        {
            if (b == null || b.Length < 4) return null;
            if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
            if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
            if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return "image/gif";
            if (b.Length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return "image/webp";
            if (b[0] == 0x42 && b[1] == 0x4D) return "image/bmp";
            var head = System.Text.Encoding.UTF8.GetString(b, 0, Math.Min(b.Length, 512)).TrimStart('\uFEFF', ' ', '\r', '\n', '\t');
            if (head.StartsWith("<svg", StringComparison.OrdinalIgnoreCase) || (head.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase) && head.IndexOf("<svg", StringComparison.OrdinalIgnoreCase) >= 0)) return "image/svg+xml";
            return null;
        }
    }
}