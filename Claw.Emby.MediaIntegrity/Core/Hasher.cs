using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;

namespace Claw.Emby.MediaIntegrity.Core
{
    /// <summary>Pause / throttle / stop controls shared by the full scan and the background queue.</summary>
    public interface IHashGate
    {
        /// <summary>Bytes per second limit, 0 = unlimited.</summary>
        long BytesPerSecond { get; }
        /// <summary>Null = go; otherwise the reason hashing is paused ("paused", "playback").</summary>
        string PauseReason { get; }
    }

    public sealed class HashOutcome
    {
        public string Md5 { get; set; }
        public long Bytes { get; set; }
        public double Seconds { get; set; }
        public string Error { get; set; }
        public bool Ok => Error == null;
    }

    public static class Hasher
    {
        public const int BufferSize = 1 << 20;

        /// <summary>
        /// Streams the file through MD5 (uppercase hex, same as Get-FileHash). Checks the gate between 1 MiB blocks:
        /// waits while paused, sleeps to honour the MB/s limit, stops on cancellation. Opens with FileShare.ReadWrite|Delete
        /// so Emby / other programs are never blocked.
        /// </summary>
        public static HashOutcome Hash(string path, IHashGate gate, CancellationToken ct, Action<long> onBytes = null, Action<string> onPause = null)
        {
            var o = new HashOutcome();
            var sw = new Stopwatch(); // active time only (excludes pauses)
            try
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, BufferSize, FileOptions.SequentialScan))
                using (var md5 = MD5.Create())
                {
                    var buf = new byte[BufferSize];
                    long windowBytes = 0; var window = Stopwatch.StartNew();
                    sw.Start();
                    while (true)
                    {
                        ct.ThrowIfCancellationRequested();
                        var why = gate?.PauseReason;
                        if (why != null)
                        {
                            sw.Stop(); onPause?.Invoke(why);
                            while ((why = gate.PauseReason) != null) { ct.ThrowIfCancellationRequested(); ct.WaitHandle.WaitOne(500); }
                            onPause?.Invoke(null); sw.Start(); window.Restart(); windowBytes = 0;
                        }
                        int n = fs.Read(buf, 0, buf.Length);
                        if (n <= 0) break;
                        md5.TransformBlock(buf, 0, n, null, 0);
                        o.Bytes += n; windowBytes += n;
                        onBytes?.Invoke(n);
                        var limit = gate?.BytesPerSecond ?? 0;
                        if (limit > 0)
                        {
                            var wantMs = windowBytes * 1000.0 / limit;
                            var ahead = wantMs - window.Elapsed.TotalMilliseconds;
                            if (ahead > 5) ct.WaitHandle.WaitOne((int)Math.Min(ahead, 2000)); // throttle sleep counts as active time (speed shown = effective speed)
                            if (window.Elapsed.TotalSeconds > 10) { window.Restart(); windowBytes = 0; }
                        }
                    }
                    md5.TransformFinalBlock(buf, 0, 0);
                    o.Md5 = Convert.ToHexString(md5.Hash);
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is System.Security.SecurityException)
            {
                o.Error = ex.GetType().Name + ": " + ex.Message;
            }
            o.Seconds = sw.Elapsed.TotalSeconds;
            return o;
        }
    }
}
