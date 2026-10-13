using System;
using System.Collections.Generic;

namespace Claw.Emby.Guard.Core
{
    public static class EventKinds
    {
        public const string SigninFailed = "signin-failed";
        public const string SigninOk = "signin-ok";
        public const string Forbidden = "signin-forbidden";
        public const string Api401 = "api-401";
        public const string Api403 = "api-403";
        public const string Banned = "banned";
        public const string Unbanned = "unbanned";
        public const string Blocked = "blocked"; // request from an already banned address
    }

    public class GuardEvent
    {
        public long Id { get; set; }
        public DateTimeOffset Time { get; set; }
        public string Kind { get; set; }
        public string Ip { get; set; }
        public string Key { get; set; }
        public string Country { get; set; }
        public string Username { get; set; }
        /// <summary>null = not a sign-in / unknown; false = no such Emby user.</summary>
        public bool? UserExists { get; set; }
        public string Client { get; set; }
        public string Device { get; set; }
        /// <summary>For API rows: METHOD /path (query string removed).</summary>
        public string Request { get; set; }
        public int Status { get; set; }
        /// <summary>Failures for this address inside the rule window, after this event.</summary>
        public int Count { get; set; }
        /// <summary>"lan", "whitelisted", "banned", "blocked", "" ...</summary>
        public string Note { get; set; }
        public string Rule { get; set; }
    }

    public class BanRecord
    {
        public string Key { get; set; }
        public string Ip { get; set; }
        public DateTimeOffset Created { get; set; }
        /// <summary>null = permanent.</summary>
        public DateTimeOffset? Expires { get; set; }
        public string Reason { get; set; }
        public string Rule { get; set; }
        public bool Manual { get; set; }
        public int Step { get; set; }
        public List<string> Usernames { get; set; } = new List<string>();
        public string Country { get; set; }
        public int Hits { get; set; }
        /// <summary>Set when lifted (expired or unbanned); kept in history for escalation.</summary>
        public DateTimeOffset? Ended { get; set; }
        public string EndReason { get; set; }

        public bool IsActive(DateTimeOffset now) => Created <= now && Ended == null && (Expires == null || Expires > now);
    }

    public class WhitelistEntry
    {
        public string Cidr { get; set; }
        public string Note { get; set; }
    }

    public class GuardRules
    {
        public bool Enabled { get; set; } = true;
        public int SigninFailThreshold { get; set; } = 5;
        public int SigninWindowMinutes { get; set; } = 10;
        public int UnknownUserFailThreshold { get; set; } = 2;
        /// <summary>Any failed sign-in with a username that does not exist in Emby bans at once (default off).</summary>
        public bool BanUnknownUsersInstantly { get; set; }
        public bool WatchApiFailures { get; set; } = true;
        public int ApiFailThreshold { get; set; } = 30;
        public int ApiWindowMinutes { get; set; } = 10;
        /// <summary>Ban length per offence, in minutes. 0 = permanent. Default 1 h, 1 d, 30 d, permanent.</summary>
        public int[] EscalationMinutes { get; set; } = { 60, 1440, 43200, 0 };
        /// <summary>A previous ban stops counting for escalation this many days after it ended. 0 = forever.</summary>
        public int EscalationResetDays { get; set; } = 30;
        public string[] InstantBanUsernames { get; set; } = DefaultInstantUsernames;
        public int Ipv6Prefix { get; set; } = 64;
        public WhitelistEntry[] Whitelist { get; set; } = Array.Empty<WhitelistEntry>();
        public bool NotifyOnBan { get; set; } = true;

        public static readonly string[] DefaultInstantUsernames =
        {
            "root", "admin", "administrator", "emby", "test", "guest", "user", "sa",
            "support", "info", "oracle", "postgres", "ubnt", "pi", "ftp", "demo", "default", "jellyfin", "plex"
        };
    }
}
