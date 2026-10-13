using System.Collections.Generic;
using global::Emby.Notifications;

namespace Claw.Emby.MediaIntegrity.Server
{
    /// <summary>Emby notification types (pick them per notifier under Settings → Notifications).</summary>
    public class IntegrityNotifications : INotificationTypeFactory
    {
        public const string SummaryEventId = "claw.mediaintegrity.scansummary";
        public const string ProblemsEventId = "claw.mediaintegrity.problems";

        public List<NotificationTypeInfo> GetNotificationTypes(string language) => new List<NotificationTypeInfo>
        {
            new NotificationTypeInfo { Id = SummaryEventId, Name = "Integrity scan finished (summary)", CategoryId = "claw.mediaintegrity", CategoryName = "Media Integrity" },
            new NotificationTypeInfo { Id = ProblemsEventId, Name = "Changed, missing or unreadable files found (one per scan)", CategoryId = "claw.mediaintegrity", CategoryName = "Media Integrity" }
        };
    }
}
