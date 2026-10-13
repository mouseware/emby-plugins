using System;
using System.Linq;
using Claw.Emby.Guard.Core;
using MediaBrowser.Model.Plugins;

namespace Claw.Emby.Guard
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        /// <summary>Master switch. Off = no new bans and Guard's entries are removed from Emby's IP filter (events still logged).</summary>
        public bool Enabled { get; set; } = true;

        public int SigninFailThreshold { get; set; } = 5;
        public int SigninWindowMinutes { get; set; } = 10;
        /// <summary>Failed sign-ins with usernames that don't exist in Emby before a ban. 0 = off.</summary>
        public int UnknownUserFailThreshold { get; set; } = 2;
        public bool BanUnknownUsersInstantly { get; set; } = false;
        public bool WatchApiFailures { get; set; } = true;
        public int ApiFailThreshold { get; set; } = 30;
        public int ApiWindowMinutes { get; set; } = 10;
        /// <summary>Ban length per offence in minutes, 0 = permanent. Default 1 h, 1 d, 30 d, permanent.</summary>
        public int[] EscalationMinutes { get; set; } = { 60, 1440, 43200, 0 };
        public int EscalationResetDays { get; set; } = 30;
        public string[] InstantBanUsernames { get; set; } = GuardRules.DefaultInstantUsernames;
        public int Ipv6Prefix { get; set; } = 64;
        public WhitelistEntry[] Whitelist { get; set; } = Array.Empty<WhitelistEntry>();
        public bool NotifyOnBan { get; set; } = true;

        /// <summary>Optional MaxMind GeoLite2 credentials. Both set = Country column + weekly DB refresh.</summary>
        public string MaxMindAccountId { get; set; } = "";
        public string MaxMindLicenseKey { get; set; } = "";

        public GuardRules ToRules() => new GuardRules
        {
            Enabled = Enabled,
            SigninFailThreshold = SigninFailThreshold,
            SigninWindowMinutes = SigninWindowMinutes,
            UnknownUserFailThreshold = UnknownUserFailThreshold,
            BanUnknownUsersInstantly = BanUnknownUsersInstantly,
            WatchApiFailures = WatchApiFailures,
            ApiFailThreshold = ApiFailThreshold,
            ApiWindowMinutes = ApiWindowMinutes,
            EscalationMinutes = (EscalationMinutes ?? new int[0]).ToArray(),
            EscalationResetDays = EscalationResetDays,
            InstantBanUsernames = (InstantBanUsernames ?? new string[0]).ToArray(),
            Ipv6Prefix = Ipv6Prefix,
            Whitelist = (Whitelist ?? new WhitelistEntry[0]).ToArray(),
            NotifyOnBan = NotifyOnBan
        };
    }
}
