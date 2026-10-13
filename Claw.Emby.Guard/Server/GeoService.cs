using System;
using System.IO;
using System.IO.Compression;
using System.Formats.Tar;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Claw.Emby.Guard.Core;
using MediaBrowser.Model.Logging;

namespace Claw.Emby.Guard.Server
{
    /// <summary>
    /// Optional GeoLite2-Country. Downloads with the user's MaxMind account ID + license key (HTTP Basic auth,
    /// permalink https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz),
    /// refreshes weekly (GeoLite EULA: keep it updated, delete old copies), deletes the DB when the key is removed.
    /// </summary>
    public class GeoService
    {
        private const string Url = "https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz";
        private readonly string _dir;
        private readonly ILogger _log;
        private volatile MmdbReader _reader;
        private volatile bool _busy;
        public string Status { get; private set; } = "No MaxMind key: Country column hidden";
        public DateTimeOffset? DbDate { get; private set; }
        public bool Available => _reader != null;
        public string DbPath => Path.Combine(_dir, "GeoLite2-Country.mmdb");

        public GeoService(string dir, ILogger log) { _dir = dir; _log = log; }

        public string Country(IPAddress ip)
        {
            var r = _reader;
            if (r == null || ip == null) return null;
            try { return r.Country(ip); } catch { return null; }
        }

        /// <summary>Called on startup, on config save and daily.</summary>
        public void Refresh(string accountId, string licenseKey, bool force)
        {
            accountId = (accountId ?? "").Trim(); licenseKey = (licenseKey ?? "").Trim();
            if (accountId.Length == 0 || licenseKey.Length == 0)
            {
                _reader = null; DbDate = null;
                if (File.Exists(DbPath)) { try { File.Delete(DbPath); } catch { } }
                Status = "No MaxMind key: Country column hidden";
                return;
            }
            if (_reader == null && File.Exists(DbPath)) Load();
            var age = File.Exists(DbPath) ? DateTime.UtcNow - File.GetLastWriteTimeUtc(DbPath) : TimeSpan.MaxValue;
            if (!force && age < TimeSpan.FromDays(7) && _reader != null) return;
            if (_busy) return;
            _busy = true;
            Task.Run(async () =>
            {
                try { await Download(accountId, licenseKey).ConfigureAwait(false); }
                catch (Exception ex)
                {
                    Status = "GeoLite2 download failed: " + ex.Message + (_reader != null ? " (using the previous copy)" : "");
                    _log?.Warn("Guard: " + Status);
                }
                finally { _busy = false; }
            });
        }

        private async Task Download(string accountId, string key)
        {
            Directory.CreateDirectory(_dir);
            using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
            using (var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(5) })
            {
                var req = new HttpRequestMessage(HttpMethod.Get, Url);
                req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.ASCII.GetBytes(accountId + ":" + key)));
                var resp = await http.SendAsync(req).ConfigureAwait(false);
                // MaxMind redirects to a presigned R2 URL: follow WITHOUT the Authorization header.
                for (int i = 0; i < 5 && (int)resp.StatusCode >= 300 && (int)resp.StatusCode < 400 && resp.Headers.Location != null; i++)
                {
                    var next = resp.Headers.Location.IsAbsoluteUri ? resp.Headers.Location : new Uri(new Uri(Url), resp.Headers.Location);
                    resp.Dispose();
                    resp = await http.GetAsync(next).ConfigureAwait(false);
                }
                if (resp.StatusCode == HttpStatusCode.Unauthorized) throw new Exception("MaxMind rejected the account ID / license key (401)");
                resp.EnsureSuccessStatusCode();
                var tmp = DbPath + ".download";
                using (var s = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var gz = new GZipStream(s, CompressionMode.Decompress))
                using (var tar = new TarReader(gz))
                {
                    TarEntry e; bool found = false;
                    while ((e = tar.GetNextEntry()) != null)
                    {
                        if (e.Name.EndsWith("GeoLite2-Country.mmdb", StringComparison.OrdinalIgnoreCase) && e.DataStream != null)
                        {
                            using (var f = File.Create(tmp)) e.DataStream.CopyTo(f);
                            found = true; break;
                        }
                    }
                    if (!found) throw new Exception("GeoLite2-Country.mmdb not found in the archive");
                }
                var check = MmdbReader.Open(tmp); // validate before replacing
                if (File.Exists(DbPath)) File.Replace(tmp, DbPath, null); else File.Move(tmp, DbPath);
                _reader = check; DbDate = check.BuildTime;
                Status = "GeoLite2-Country loaded (build " + check.BuildTime.ToString("yyyy-MM-dd") + "). This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com";
                _log?.Info("Guard: GeoLite2-Country updated");
            }
        }

        private void Load()
        {
            try
            {
                var r = MmdbReader.Open(DbPath);
                _reader = r; DbDate = r.BuildTime;
                Status = "GeoLite2-Country loaded (build " + r.BuildTime.ToString("yyyy-MM-dd") + "). This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com";
            }
            catch (Exception ex) { Status = "GeoLite2 file unreadable: " + ex.Message; _reader = null; }
        }
    }
}
