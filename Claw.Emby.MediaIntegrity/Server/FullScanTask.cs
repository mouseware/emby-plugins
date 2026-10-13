using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Model.Tasks;

namespace Claw.Emby.MediaIntegrity.Server
{
    /// <summary>Scheduled task "Full integrity scan" (Dashboard → Scheduled tasks → Media Integrity). Default: every 6 months.</summary>
    public class FullScanTask : IScheduledTask, IConfigurableScheduledTask
    {
        public string Name => "Full integrity scan";
        public string Key => "ClawMediaIntegrityFullScan";
        public string Description => "Re-hashes every file in the library folders (and extra folders) and compares with the stored MD5 baseline. Resumable, low priority, pauses during playback.";
        public string Category => "Media Integrity";
        public bool IsHidden => false;
        public bool IsEnabled => true;
        public bool IsLogged => true;

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => new[]
        {
            new TaskTriggerInfo { Type = "IntervalTrigger", IntervalTicks = TimeSpan.FromDays(182).Ticks }
        };

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            var host = IntegrityHost.Instance;
            if (host == null) return Task.CompletedTask;
            return host.RunFullScanAsync(cancellationToken, progress);
        }
    }
}
