using System;
using System.Collections.Generic;

namespace Claw.Emby.SeerrRequests.Core
{
    public static class SeerrMediaStatus
    {
        public const int Unknown = 1;
        public const int Pending = 2;
        public const int Processing = 3;
        public const int PartiallyAvailable = 4;
        public const int Available = 5;
        public const int Blocklisted = 6;
        public const int Deleted = 7;
    }

    public static class SeerrRequestStatus
    {
        public const int Pending = 1;
        public const int Approved = 2;
        public const int Declined = 3;
        public const int Failed = 4;
        public const int Completed = 5;
    }

    public static class DisplayStatus
    {
        public const string None = "None";
        public const string Available = "Available";
        public const string Requested = "Requested";
        public const string Pending = "Pending";
        public const string Declined = "Declined";
        public const string Partial = "Partially available";
        public const string Blocked = "Blocklisted";
    }

    public class RequestItem
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public string ExtraType { get; set; }
        public string Path { get; set; }
        public string LocationType { get; set; }
        public int MediaSourceCount { get; set; }
        public int? Year { get; set; }
        public string Tmdb { get; set; }
        public string Tvdb { get; set; }
        public string Imdb { get; set; }
        public string LibraryId { get; set; }
        public string SeriesId { get; set; }
        public int? SeasonNumber { get; set; }

        public bool HasLocalMedia =>
            !string.IsNullOrWhiteSpace(Path)
            && !string.Equals(LocationType, "Virtual", StringComparison.OrdinalIgnoreCase)
            && MediaSourceCount > 0;
    }

    public class SeerrUserInfo
    {
        public string Id { get; set; }
        public string DisplayName { get; set; }
        public string Email { get; set; }
        public string JellyfinUserId { get; set; }
        public string JellyfinUsername { get; set; }
        public bool IsAdmin { get; set; }
    }

    public class SeerrSeasonInfo
    {
        public int SeasonNumber { get; set; }
        public string Name { get; set; }
        public int? EpisodeCount { get; set; }
        public string Status { get; set; }
        public bool CanRequest { get; set; }
    }

    public class SeerrMediaInfo
    {
        public int? TmdbId { get; set; }
        public int? TvdbId { get; set; }
        public string ImdbId { get; set; }
        public string Title { get; set; }
        public int? Year { get; set; }
        public string MediaType { get; set; }
        public int? MediaStatus { get; set; }
        public int? RequestStatus { get; set; }
        public string Display { get; set; }
        public List<SeerrSeasonInfo> Seasons { get; set; } = new List<SeerrSeasonInfo>();
    }

    public class MatchResult
    {
        public bool Matched { get; set; }
        public string SeerrUserId { get; set; }
        public string SeerrUserName { get; set; }
        public string How { get; set; }
        public string Message { get; set; }
    }

    public class ActivityEntry
    {
        public string Id { get; set; }
        public DateTime WhenUtc { get; set; }
        public string EmbyUserId { get; set; }
        public string EmbyUserName { get; set; }
        public string SeerrUserId { get; set; }
        public string SeerrUserName { get; set; }
        public string Title { get; set; }
        public int? Year { get; set; }
        public string MediaType { get; set; }
        public string TmdbId { get; set; }
        public string TvdbId { get; set; }
        public string Seasons { get; set; }
        public string Result { get; set; }
        public string Detail { get; set; }
        public string ItemId { get; set; }
    }

    public class SeerrHttpResponse
    {
        public int Status { get; set; }
        public string Body { get; set; }
        public string Error { get; set; }
    }

    public interface ISeerrTransport
    {
        /// <summary>Send an HTTP call. The transport adds the API key header; callers must never log the key.</summary>
        SeerrHttpResponse Send(string method, string url, string jsonBody, string apiKey, string asUserId);
    }
}
