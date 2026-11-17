using System;
using System.Collections.Generic;

namespace Claw.Emby.SeerrRequests.Core
{
    public static class Eligibility
    {
        public const string UnmatchedMessage =
            "Your Emby account is not linked to a Seerr user. Ask an administrator to add a mapping under Seerr Requests → Settings. Requests are never sent as the Seerr admin.";

        public const string DisabledMessage = "Seerr Requests is switched off.";
        public const string NotConfiguredMessage = "Seerr isn't set up yet. An administrator needs to set the Seerr URL and API key under Seerr Requests → Settings.";
        public const string NoPermissionMessage = "You do not have permission to request titles.";
        public const string NotEligibleMessage = "\"Request this now\" is only shown on trailers and on movies or shows that are not already in this library.";
        public const string LibraryMessage = "This library is not enabled for Seerr requests.";
        public const string NoIdMessage = "This item has no TMDb or TVDb id, so it cannot be requested in Seerr.";
        public const string MenuName = "Request this now";

        public static bool IsTrailer(RequestItem item)
        {
            if (item == null) return false;
            if (string.Equals(item.Type, "Trailer", StringComparison.OrdinalIgnoreCase)) return true;
            return string.Equals(item.ExtraType, "Trailer", StringComparison.OrdinalIgnoreCase)
                || string.Equals(item.ExtraType, "TrailerOf", StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsMovieOrShow(RequestItem item)
        {
            if (item == null || item.Type == null) return false;
            return string.Equals(item.Type, "Movie", StringComparison.OrdinalIgnoreCase)
                || string.Equals(item.Type, "Series", StringComparison.OrdinalIgnoreCase)
                || string.Equals(item.Type, "Season", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>A movie/show already in the library with local media is owned; the menu stays hidden. Trailers are never treated as ownership of the feature.</summary>
        public static bool IsUnownedMovieOrShow(RequestItem item)
        {
            return IsMovieOrShow(item) && !IsTrailer(item) && !item.HasLocalMedia;
        }

        public static bool ItemEligible(RequestItem item)
        {
            if (item == null || string.IsNullOrWhiteSpace(item.Id)) return false;
            if (IsTrailer(item)) return true;
            return IsUnownedMovieOrShow(item);
        }

        public static bool UserCanSee(PluginConfiguration cfg, string userId, string userName, bool isAdmin)
        {
            if (cfg == null) return false;
            var mode = (cfg.VisibilityMode ?? "all").Trim().ToLowerInvariant();
            if (mode == "admins") return isAdmin;
            if (mode == "allowlist")
            {
                if (ContainsId(cfg.AllowedUserIds, userId)) return true;
                if (ContainsName(cfg.AllowedUserNames, userName)) return true;
                return false;
            }
            return true;
        }

        public static bool LibraryAllowed(PluginConfiguration cfg, string libraryId)
        {
            if (cfg == null) return false;
            var list = cfg.AllowedLibraryIds;
            if (list == null || list.Length == 0) return true;
            return ContainsId(list, libraryId);
        }

        public static bool MenuVisible(PluginConfiguration cfg, RequestItem item, string userId, string userName, bool isAdmin)
        {
            if (cfg == null || !cfg.Enabled) return false;
            if (!UserCanSee(cfg, userId, userName, isAdmin)) return false;
            if (!ItemEligible(item)) return false;
            return LibraryAllowed(cfg, item != null ? item.LibraryId : null);
        }

        public static string MediaTypeOf(RequestItem item)
        {
            if (item == null) return "movie";
            if (string.Equals(item.Type, "Series", StringComparison.OrdinalIgnoreCase)
                || string.Equals(item.Type, "Season", StringComparison.OrdinalIgnoreCase)
                || string.Equals(item.Type, "Episode", StringComparison.OrdinalIgnoreCase))
                return "tv";
            return "movie";
        }

        public static bool HasProviderId(RequestItem item)
        {
            return item != null && (!string.IsNullOrWhiteSpace(item.Tmdb) || !string.IsNullOrWhiteSpace(item.Tvdb) || !string.IsNullOrWhiteSpace(item.Imdb));
        }

        static bool ContainsId(IEnumerable<string> ids, string id)
        {
            if (ids == null || string.IsNullOrWhiteSpace(id)) return false;
            foreach (var x in ids)
                if (!string.IsNullOrWhiteSpace(x) && string.Equals(x.Trim(), id.Trim(), StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }

        static bool ContainsName(IEnumerable<string> names, string name)
        {
            if (names == null || string.IsNullOrWhiteSpace(name)) return false;
            foreach (var x in names)
                if (!string.IsNullOrWhiteSpace(x) && string.Equals(x.Trim(), name.Trim(), StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }
    }
}
