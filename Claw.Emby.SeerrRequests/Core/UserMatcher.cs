using System;
using System.Collections.Generic;

namespace Claw.Emby.SeerrRequests.Core
{
    public static class UserMatcher
    {
        /// <summary>
        /// Resolve the Seerr user for an Emby user. Manual overrides win. Auto-match uses Seerr's stored
        /// Jellyfin/Emby user id. An unmatched user is never sent as the Seerr admin.
        /// </summary>
        public static MatchResult Match(PluginConfiguration cfg, string embyUserId, string embyUserName, IList<SeerrUserInfo> seerrUsers)
        {
            var r = new MatchResult();
            if (string.IsNullOrWhiteSpace(embyUserId) && string.IsNullOrWhiteSpace(embyUserName))
            {
                r.Message = Eligibility.UnmatchedMessage;
                return r;
            }

            var maps = cfg != null ? cfg.UserMaps : null;
            if (maps != null)
            {
                for (var i = 0; i < maps.Length; i++)
                {
                    var m = maps[i];
                    if (m == null || string.IsNullOrWhiteSpace(m.SeerrUserId)) continue;
                    var idOk = !string.IsNullOrWhiteSpace(embyUserId) && !string.IsNullOrWhiteSpace(m.EmbyUserId)
                        && string.Equals(m.EmbyUserId.Trim(), embyUserId.Trim(), StringComparison.OrdinalIgnoreCase);
                    var nameOk = !idOk && !string.IsNullOrWhiteSpace(embyUserName) && !string.IsNullOrWhiteSpace(m.EmbyUserName)
                        && string.Equals(m.EmbyUserName.Trim(), embyUserName.Trim(), StringComparison.OrdinalIgnoreCase);
                    if (!idOk && !nameOk) continue;
                    r.Matched = true;
                    r.SeerrUserId = m.SeerrUserId.Trim();
                    r.SeerrUserName = string.IsNullOrWhiteSpace(m.SeerrUserName) ? NameOf(seerrUsers, r.SeerrUserId) : m.SeerrUserName;
                    r.How = "manual";
                    return r;
                }
            }

            var auto = AutoMatch(embyUserId, seerrUsers);
            if (auto != null)
            {
                r.Matched = true;
                r.SeerrUserId = auto.Id;
                r.SeerrUserName = auto.DisplayName ?? auto.JellyfinUsername ?? auto.Email;
                r.How = "auto";
                return r;
            }

            r.Message = Eligibility.UnmatchedMessage;
            return r;
        }

        public static SeerrUserInfo AutoMatch(string embyUserId, IList<SeerrUserInfo> seerrUsers)
        {
            if (string.IsNullOrWhiteSpace(embyUserId) || seerrUsers == null) return null;
            var want = NormalizeId(embyUserId);
            if (want == null) return null;
            for (var i = 0; i < seerrUsers.Count; i++)
            {
                var u = seerrUsers[i];
                if (u == null) continue;
                var have = NormalizeId(u.JellyfinUserId);
                if (have != null && have == want) return u;
            }
            return null;
        }

        /// <summary>Seerr stores Emby/Jellyfin GUIDs with or without dashes and with either case.</summary>
        public static string NormalizeId(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            var t = id.Trim().Replace("-", "").ToLowerInvariant();
            return t.Length == 0 ? null : t;
        }

        static string NameOf(IList<SeerrUserInfo> users, string seerrId)
        {
            if (users == null || string.IsNullOrWhiteSpace(seerrId)) return seerrId;
            for (var i = 0; i < users.Count; i++)
            {
                var u = users[i];
                if (u != null && u.Id == seerrId)
                    return u.DisplayName ?? u.JellyfinUsername ?? u.Email ?? seerrId;
            }
            return seerrId;
        }
    }
}
