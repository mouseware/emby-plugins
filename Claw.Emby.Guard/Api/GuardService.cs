using System;
using System.Collections.Generic;
using System.Linq;
using Claw.Emby.Guard.Core;
using Claw.Emby.Guard.Server;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Services;

namespace Claw.Emby.Guard.Api
{
    [Route("/ClawGuard/Status", "GET", Summary = "Guard: counters, enforcement state, retention, your address")]
    [Authenticated(Roles = "Admin")]
    public class GetGuardStatus : IReturn<GuardStatus> { }

    [Route("/ClawGuard/Events", "GET", Summary = "Guard: security log, newest first")]
    [Authenticated(Roles = "Admin")]
    public class GetGuardEvents : IReturn<List<GuardEvent>>
    {
        [ApiMember(Name = "SinceId", Description = "Only events newer than this id (live polling)", DataType = "long", ParameterType = "query", Verb = "GET")]
        public long? SinceId { get; set; }
        [ApiMember(Name = "Hours", Description = "History window in hours (0 = everything kept)", DataType = "int", ParameterType = "query", Verb = "GET")]
        public int? Hours { get; set; }
        [ApiMember(Name = "Limit", Description = "Max rows (default 500, max 5000)", DataType = "int", ParameterType = "query", Verb = "GET")]
        public int? Limit { get; set; }
    }

    [Route("/ClawGuard/Bans", "GET", Summary = "Guard: active bans and recent history")]
    [Authenticated(Roles = "Admin")]
    public class GetGuardBans : IReturn<BansResult> { }

    [Route("/ClawGuard/Bans", "POST", Summary = "Guard: manual ban (Minutes 0 = permanent)")]
    [Authenticated(Roles = "Admin")]
    public class PostGuardBan : IReturn<BanResult>
    {
        public string Ip { get; set; }
        public int Minutes { get; set; }
        public string Reason { get; set; }
        /// <summary>Required to ban the address the request comes from.</summary>
        public bool Confirm { get; set; }
    }

    [Route("/ClawGuard/Bans/Unban", "POST", Summary = "Guard: lift a ban")]
    [Authenticated(Roles = "Admin")]
    public class PostGuardUnban : IReturn<OkResult> { public string Key { get; set; } }

    [Route("/ClawGuard/Bans/Extend", "POST", Summary = "Guard: extend a ban by Minutes (0 = make permanent)")]
    [Authenticated(Roles = "Admin")]
    public class PostGuardExtend : IReturn<OkResult> { public string Key { get; set; } public int Minutes { get; set; } }

    [Route("/ClawGuard/Whitelist", "POST", Summary = "Guard: add an address/CIDR to the whitelist (lifts its ban)")]
    [Authenticated(Roles = "Admin")]
    public class PostGuardWhitelist : IReturn<OkResult> { public string Cidr { get; set; } public string Note { get; set; } }

    [Route("/ClawGuard/InstantUsernames", "POST", Summary = "Guard: add a username to the instant-ban list")]
    [Authenticated(Roles = "Admin")]
    public class PostGuardInstantUser : IReturn<OkResult> { public string Username { get; set; } }

    [Route("/ClawGuard/Geo/Refresh", "POST", Summary = "Guard: download the GeoLite2-Country database now")]
    [Authenticated(Roles = "Admin")]
    public class PostGuardGeoRefresh : IReturn<OkResult> { }

    [Route("/ClawGuard/Import", "POST", Summary = "Guard: import failed sign-ins and 401/403s from the existing embyserver*.txt logs and apply the ban rules")]
    [Authenticated(Roles = "Admin")]
    public class PostGuardImport : IReturn<ImportResult> { }

    public class OkResult { public bool Ok { get; set; } public string Error { get; set; } }

    public class BansResult
    {
        public List<BanRecord> Active { get; set; }
        public List<BanRecord> History { get; set; }
        public DateTimeOffset Now { get; set; }
    }

    public class GuardStatus
    {
        public bool Enabled { get; set; }
        public string FilterState { get; set; }
        public int ManualFilterEntries { get; set; }
        public int ActiveBans { get; set; }
        public int Failed24h { get; set; }
        public int ApiFailures24h { get; set; }
        public int DistinctIps24h { get; set; }
        public int Bans24h { get; set; }
        public string YourIp { get; set; }
        public bool YourIpIsLan { get; set; }
        public string RetentionText { get; set; }
        public int RetentionDays { get; set; }
        public int LogFileRetentionDays { get; set; }
        public bool CountryEnabled { get; set; }
        public string GeoStatus { get; set; }
        public string TailStatus { get; set; }
        public string LanNote { get; set; }
        public DateTimeOffset Now { get; set; }
        public long LastEventId { get; set; }
    }

    public class GuardService : IService, IRequiresRequest
    {
        public IRequest Request { get; set; }

        private static GuardEntryPoint G
        {
            get
            {
                var g = GuardEntryPoint.Instance;
                if (g == null || g.Engine == null) throw new InvalidOperationException("Guard is still starting");
                return g;
            }
        }

        private string Caller => Request?.RemoteIp == null ? null : IpUtil.Normalize(Request.RemoteIp).ToString();

        public object Get(GetGuardStatus r)
        {
            var g = G; var now = DateTimeOffset.UtcNow;
            var day = g.Store.ReadEvents(now.AddHours(-24), null, 100000);
            var ret = g.Retention;
            var caller = IpUtil.Parse(Caller);
            return new GuardStatus
            {
                Enabled = g.Engine.Rules.Enabled,
                FilterState = g.FilterState,
                ManualFilterEntries = g.ManualFilterCount,
                ActiveBans = g.Store.ActiveBans(now).Count(),
                Failed24h = day.Count(e => e.Kind == EventKinds.SigninFailed || e.Kind == EventKinds.Forbidden),
                ApiFailures24h = day.Count(e => e.Kind == EventKinds.Api401 || e.Kind == EventKinds.Api403),
                DistinctIps24h = day.Where(e => e.Kind != EventKinds.SigninOk && !string.IsNullOrEmpty(e.Ip)).Select(e => e.Ip).Distinct().Count(),
                Bans24h = day.Count(e => e.Kind == EventKinds.Banned),
                YourIp = Caller,
                YourIpIsLan = caller != null && g.Engine.IsSafe(caller),
                RetentionText = ret.Text,
                RetentionDays = ret.Days,
                LogFileRetentionDays = ret.LogFileRetentionDays,
                CountryEnabled = g.Geo.Available,
                GeoStatus = g.Geo.Status,
                TailStatus = g.TailStatus,
                LanNote = "Home/LAN addresses (loopback, 10/8, 172.16/12, 192.168/16, link-local, 100.64/10, IPv6 ULA/link-local and Emby's LAN networks) are never filtered by Emby, so Guard never bans them.",
                Now = now,
                LastEventId = g.Store.Data.LastEventId
            };
        }

        public object Get(GetGuardEvents r)
        {
            var g = G;
            var limit = Math.Max(1, Math.Min(r.Limit ?? 500, 5000));
            if (r.SinceId.HasValue) return g.Store.Recent(r.SinceId.Value, limit);
            var hours = r.Hours ?? 24;
            return g.Store.ReadEvents(hours > 0 ? DateTimeOffset.UtcNow.AddHours(-hours) : (DateTimeOffset?)null, null, limit);
        }

        public object Get(GetGuardBans r)
        {
            var g = G; var now = DateTimeOffset.UtcNow;
            return new BansResult
            {
                Active = g.Store.ActiveBans(now).OrderByDescending(b => b.Created).ToList(),
                History = g.Store.Bans.Where(b => !b.IsActive(now)).OrderByDescending(b => b.Ended ?? b.Created).Take(200).ToList(),
                Now = now
            };
        }

        public object Post(PostGuardImport r) => G.ImportLogs();

        public object Post(PostGuardBan r) => G.Engine.ManualBan(r.Ip, r.Minutes, r.Reason, Caller, r.Confirm);

        public object Post(PostGuardUnban r) => new OkResult { Ok = G.Engine.Unban(r.Key), Error = null };

        public object Post(PostGuardExtend r) => new OkResult { Ok = G.Engine.Extend(r.Key, r.Minutes) };

        public object Post(PostGuardWhitelist r)
        {
            var g = G;
            if (!IpUtil.TryParseCidr(r.Cidr, out _, out _)) return new OkResult { Error = "Not an IP address or CIDR" };
            var cfg = Plugin.Instance.Configuration;
            var list = (cfg.Whitelist ?? new WhitelistEntry[0]).ToList();
            if (!list.Any(w => string.Equals(w.Cidr, r.Cidr.Trim(), StringComparison.OrdinalIgnoreCase)))
                list.Add(new WhitelistEntry { Cidr = r.Cidr.Trim(), Note = r.Note });
            cfg.Whitelist = list.ToArray();
            Plugin.Instance.SaveConfiguration();
            g.ApplyConfiguration();
            return new OkResult { Ok = true };
        }

        public object Post(PostGuardInstantUser r)
        {
            var name = (r.Username ?? "").Trim();
            if (name.Length == 0) return new OkResult { Error = "Username required" };
            var cfg = Plugin.Instance.Configuration;
            var list = (cfg.InstantBanUsernames ?? new string[0]).ToList();
            if (!list.Any(x => string.Equals(x, name, StringComparison.OrdinalIgnoreCase))) list.Add(name);
            cfg.InstantBanUsernames = list.ToArray();
            Plugin.Instance.SaveConfiguration();
            G.ApplyConfiguration();
            return new OkResult { Ok = true };
        }

        public object Post(PostGuardGeoRefresh r) { G.RefreshGeo(true); return new OkResult { Ok = true }; }
    }
}
