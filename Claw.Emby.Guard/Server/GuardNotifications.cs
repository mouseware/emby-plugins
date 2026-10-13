using System.Collections.Generic;
using global::Emby.Notifications;

namespace Claw.Emby.Guard.Server
{
    /// <summary>Registers the "IP banned" event so it can be picked per notifier in Emby's Notifications settings.</summary>
    public class GuardNotifications : INotificationTypeFactory
    {
        public const string BanEventId = "claw.guard.ipbanned";

        public List<NotificationTypeInfo> GetNotificationTypes(string language)
        {
            return new List<NotificationTypeInfo>
            {
                new NotificationTypeInfo { Id = BanEventId, Name = "IP address banned", CategoryId = "claw.guard", CategoryName = "Guard" }
            };
        }
    }
}
