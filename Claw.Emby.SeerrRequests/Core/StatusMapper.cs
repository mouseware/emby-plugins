using System.Collections.Generic;

namespace Claw.Emby.SeerrRequests.Core
{
    public static class StatusMapper
    {
        public static string From(int? mediaStatus, int? requestStatus)
        {
            if (mediaStatus == SeerrMediaStatus.Available) return DisplayStatus.Available;
            if (mediaStatus == SeerrMediaStatus.Blocklisted) return DisplayStatus.Blocked;
            if (mediaStatus == SeerrMediaStatus.PartiallyAvailable) return DisplayStatus.Partial;
            if (mediaStatus == SeerrMediaStatus.Pending || requestStatus == SeerrRequestStatus.Pending)
                return DisplayStatus.Pending;
            if (mediaStatus == SeerrMediaStatus.Processing || requestStatus == SeerrRequestStatus.Approved || requestStatus == SeerrRequestStatus.Completed)
                return DisplayStatus.Requested;
            if (requestStatus == SeerrRequestStatus.Declined) return DisplayStatus.Declined;
            return DisplayStatus.None;
        }

        public static string SeasonFrom(int? seasonMediaStatus)
        {
            return From(seasonMediaStatus, null);
        }

        /// <summary>A new request is allowed unless the title (or every requested season) is already in flight or available.</summary>
        public static bool CanRequest(string display, bool isTv, IList<SeerrSeasonInfo> seasons, bool requestAll, IList<int> requestedSeasons)
        {
            if (display == DisplayStatus.Blocked) return false;
            if (display == DisplayStatus.Available && !isTv) return false;
            if (display == DisplayStatus.Pending || display == DisplayStatus.Requested) return false;
            if (display == DisplayStatus.Declined || display == DisplayStatus.None) return true;
            if (display == DisplayStatus.Partial || (isTv && display == DisplayStatus.Available))
            {
                if (seasons == null || seasons.Count == 0) return display != DisplayStatus.Available;
                if (requestAll)
                {
                    for (var i = 0; i < seasons.Count; i++)
                        if (seasons[i].SeasonNumber > 0 && seasons[i].CanRequest) return true;
                    return false;
                }
                if (requestedSeasons == null || requestedSeasons.Count == 0) return false;
                for (var i = 0; i < requestedSeasons.Count; i++)
                {
                    var n = requestedSeasons[i];
                    for (var j = 0; j < seasons.Count; j++)
                        if (seasons[j].SeasonNumber == n && seasons[j].CanRequest) return true;
                }
                return false;
            }
            return true;
        }

        public static bool SeasonCanRequest(string seasonDisplay)
        {
            return seasonDisplay == DisplayStatus.None || seasonDisplay == DisplayStatus.Declined;
        }
    }
}
