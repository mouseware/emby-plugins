using System;
using System.Reflection;

namespace Claw.Emby.Guard.Core
{
    /// <summary>
    /// Event retention follows Emby. Emby 4.10.1 has NO activity-log retention setting (ServerConfiguration only
    /// has LogFileRetentionDays, for the text log files; ActivityLog entries are kept forever). So Guard keeps its
    /// security log forever too. If a future Emby adds an ActivityLog retention property, it is picked up by name.
    /// </summary>
    public static class Retention
    {
        public static readonly string[] Candidates = { "ActivityLogRetentionDays", "ActivityLogRetentionPeriod", "ActivityLogDaysToKeep" };

        public class Info
        {
            public int Days { get; set; }          // 0 = forever
            public string Source { get; set; }
            public int LogFileRetentionDays { get; set; }
            public string Text => Days > 0 ? Days + " days (" + Source + ")" : "Forever (" + Source + ")";
        }

        public static Info FromConfig(object serverConfig)
        {
            var info = new Info { Days = 0, Source = "Emby keeps the activity log forever; no retention setting in this version" };
            if (serverConfig == null) return info;
            var t = serverConfig.GetType();
            var lf = t.GetProperty("LogFileRetentionDays", BindingFlags.Public | BindingFlags.Instance);
            if (lf != null && lf.GetValue(serverConfig) is int lfd) info.LogFileRetentionDays = lfd;
            foreach (var name in Candidates)
            {
                var p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                if (p == null) continue;
                var v = p.GetValue(serverConfig);
                if (v is int d) { info.Days = d > 0 ? d : 0; info.Source = "Emby " + name; return info; }
            }
            return info;
        }
    }
}
