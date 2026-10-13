using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Claw.Emby.MediaIntegrity.Core;
using MediaBrowser.Model.Tasks;

namespace Claw.Emby.MediaIntegrity.Server
{
    /// <summary>Scheduled task "Manual integrity check": no triggers of its own. The plugin starts it whenever manual work
    /// (Check now, Check selected, Check this library, Verify integrity) is queued, so the dashboard shows it running with
    /// its overall progress. Cancelling it cancels the manual queue; it ends when the queue is empty.</summary>
    public class ManualCheckTask : IScheduledTask, IConfigurableScheduledTask
    {
        public string Name => "Manual integrity check";
        public string Key => "ClawMediaIntegrityManualCheck";
        public string Description => "Runs the files queued by Check now, Check selected, Check this library/folder and Verify integrity. Started automatically when something is queued; cancel to stop the queue.";
        public string Category => "Media Integrity";
        public bool IsHidden => false;
        public bool IsEnabled => true;
        public bool IsLogged => true;

        public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => Array.Empty<TaskTriggerInfo>();

        public Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
        {
            var q = IntegrityHost.Instance?.Manual;
            if (q == null) return Task.CompletedTask;
            return Task.Run(() => ManualCheckQueue.RunWhileBusy(q, cancellationToken, progress), CancellationToken.None);
        }
    }
}
