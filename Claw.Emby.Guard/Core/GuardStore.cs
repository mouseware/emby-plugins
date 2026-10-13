using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace Claw.Emby.Guard.Core
{
    /// <summary>
    /// Persistence. bans.json = all bans (active + history, for escalation) and what Guard owns in
    /// Emby's Remote IP filter. events/yyyy-MM-dd.jsonl = append-only event log, one file per day
    /// (UTC). Recent events are also kept in memory for the live log.
    /// </summary>
    public class GuardStore
    {
        public class State
        {
            public List<BanRecord> Bans { get; set; } = new List<BanRecord>();
            /// <summary>Entries Guard itself put in Emby's RemoteIPFilter (anything else there is manual).</summary>
            public List<string> OwnedFilterEntries { get; set; } = new List<string>();
            /// <summary>Emby's filter mode before Guard switched it to blacklist (restored by the off switch).</summary>
            public bool? OriginalBlacklistMode { get; set; }
            public long LastEventId { get; set; }
        }

        public const int MemoryEvents = 5000;
        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions { WriteIndented = true };
        private static readonly JsonSerializerOptions JsonLine = new JsonSerializerOptions { WriteIndented = false };
        private readonly string _dir;
        private readonly object _lock = new object();
        private readonly LinkedList<GuardEvent> _recent = new LinkedList<GuardEvent>();
        private readonly List<GuardEvent> _pendingWrites = new List<GuardEvent>();

        public State Data { get; private set; } = new State();
        public List<BanRecord> Bans => Data.Bans;
        public string Directory => _dir;
        public string EventsDir => Path.Combine(_dir, "events");

        public GuardStore(string dir)
        {
            _dir = dir;
        }

        public void Load()
        {
            lock (_lock)
            {
                var p = Path.Combine(_dir, "bans.json");
                if (File.Exists(p))
                {
                    try { Data = JsonSerializer.Deserialize<State>(File.ReadAllText(p)) ?? new State(); }
                    catch
                    {
                        // keep the unreadable file for inspection, start clean
                        try { File.Copy(p, p + ".bad-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"), true); } catch { }
                        Data = new State();
                    }
                }
                Data.Bans = Data.Bans ?? new List<BanRecord>();
                Data.OwnedFilterEntries = Data.OwnedFilterEntries ?? new List<string>();
                // warm the live log with the last two days
                _recent.Clear();
                foreach (var e in ReadEvents(DateTimeOffset.UtcNow.AddDays(-2), null, MemoryEvents)) _recent.AddLast(e);
                // ReadEvents returns newest first; keep _recent oldest -> newest
                var list = _recent.Reverse().ToList(); _recent.Clear(); foreach (var e in list) _recent.AddLast(e);
                if (_recent.Count > 0 && _recent.Last.Value.Id > Data.LastEventId) Data.LastEventId = _recent.Last.Value.Id;
            }
        }

        public void Save()
        {
            lock (_lock)
            {
                System.IO.Directory.CreateDirectory(_dir);
                var p = Path.Combine(_dir, "bans.json");
                var tmp = p + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(Data, Json));
                if (File.Exists(p)) File.Replace(tmp, p, null); else File.Move(tmp, p);
                FlushEvents();
            }
        }

        /// <summary>When set (log import), appended to the Note of every event added.</summary>
        public string ImportTag { get; set; }

        public void AddEvent(GuardEvent e)
        {
            lock (_lock)
            {
                if (ImportTag != null) e.Note = string.IsNullOrEmpty(e.Note) ? ImportTag : e.Note + ", " + ImportTag;
                e.Id = ++Data.LastEventId;
                _recent.AddLast(e);
                while (_recent.Count > MemoryEvents) _recent.RemoveFirst();
                _pendingWrites.Add(e);
            }
        }

        private void FlushEvents()
        {
            if (_pendingWrites.Count == 0) return;
            System.IO.Directory.CreateDirectory(EventsDir);
            foreach (var g in _pendingWrites.GroupBy(e => e.Time.UtcDateTime.ToString("yyyy-MM-dd")))
            {
                var path = Path.Combine(EventsDir, g.Key + ".jsonl");
                File.AppendAllLines(path, g.Select(e => JsonSerializer.Serialize(e, JsonLine)));
            }
            _pendingWrites.Clear();
        }

        /// <summary>Newest first. sinceId: only events with a larger id (live polling, from memory).</summary>
        public List<GuardEvent> Recent(long sinceId, int limit)
        {
            lock (_lock)
            {
                var res = new List<GuardEvent>();
                for (var n = _recent.Last; n != null && res.Count < limit; n = n.Previous)
                {
                    if (n.Value.Id <= sinceId) break;
                    res.Add(n.Value);
                }
                return res;
            }
        }

        /// <summary>Newest first, from the daily files (plus unflushed). from/to null = unbounded.</summary>
        public List<GuardEvent> ReadEvents(DateTimeOffset? from, DateTimeOffset? to, int limit)
        {
            var res = new List<GuardEvent>();
            lock (_lock)
            {
                res.AddRange(_pendingWrites.AsEnumerable().Reverse().Where(e => (from == null || e.Time >= from) && (to == null || e.Time <= to)));
                if (System.IO.Directory.Exists(EventsDir))
                {
                    var files = System.IO.Directory.GetFiles(EventsDir, "*.jsonl").OrderByDescending(f => f, StringComparer.Ordinal);
                    foreach (var f in files)
                    {
                        if (res.Count >= limit) break;
                        if (from != null && DateTime.TryParse(Path.GetFileNameWithoutExtension(f), out var day) && day.Date < from.Value.UtcDateTime.Date) break;
                        string[] lines;
                        try { lines = File.ReadAllLines(f); } catch { continue; }
                        for (int i = lines.Length - 1; i >= 0 && res.Count < limit; i--)
                        {
                            GuardEvent e;
                            try { e = JsonSerializer.Deserialize<GuardEvent>(lines[i]); } catch { continue; }
                            if (e == null) continue;
                            if (from != null && e.Time < from) continue;
                            if (to != null && e.Time > to) continue;
                            res.Add(e);
                        }
                    }
                }
            }
            return res.Take(limit).ToList();
        }

        /// <summary>Delete daily files older than N days. days &lt;= 0 = keep forever. Returns files removed.</summary>
        public int PurgeEvents(int days, DateTimeOffset now)
        {
            if (days <= 0 || !System.IO.Directory.Exists(EventsDir)) return 0;
            int n = 0;
            var cutoff = now.UtcDateTime.Date.AddDays(-days);
            foreach (var f in System.IO.Directory.GetFiles(EventsDir, "*.jsonl"))
            {
                if (DateTime.TryParse(Path.GetFileNameWithoutExtension(f), out var day) && day.Date < cutoff)
                {
                    try { File.Delete(f); n++; } catch { }
                }
            }
            return n;
        }

        public BanRecord FindActive(string key, DateTimeOffset now) =>
            key == null ? null : Data.Bans.LastOrDefault(b => string.Equals(b.Key, key, StringComparison.OrdinalIgnoreCase) && b.IsActive(now));

        public IEnumerable<BanRecord> ActiveBans(DateTimeOffset now) => Data.Bans.Where(b => b.IsActive(now));
    }
}
