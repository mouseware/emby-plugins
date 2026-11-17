using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;

namespace Claw.Emby.SeerrRequests.Core
{
    public class ActivityStore
    {
        public const int DefaultCap = 500;
        readonly string _path;
        readonly int _cap;
        readonly object _gate = new object();

        public ActivityStore(string directory, int cap = DefaultCap)
        {
            Directory.CreateDirectory(directory);
            _path = Path.Combine(directory, "activity.json");
            _cap = cap > 0 ? cap : DefaultCap;
        }

        public string PathName => _path;

        public List<ActivityEntry> List()
        {
            lock (_gate) return Load();
        }

        public ActivityEntry Add(ActivityEntry entry)
        {
            if (entry == null) throw new ArgumentNullException(nameof(entry));
            if (string.IsNullOrWhiteSpace(entry.Id)) entry.Id = Guid.NewGuid().ToString("N");
            if (entry.WhenUtc == default) entry.WhenUtc = DateTime.UtcNow;
            lock (_gate)
            {
                var all = Load();
                all.Insert(0, entry);
                while (all.Count > _cap) all.RemoveAt(all.Count - 1);
                Save(all);
            }
            return entry;
        }

        List<ActivityEntry> Load()
        {
            if (!File.Exists(_path)) return new List<ActivityEntry>();
            try
            {
                var json = File.ReadAllText(_path, Encoding.UTF8);
                var list = JsonSerializer.Deserialize<List<ActivityEntry>>(json, JsonOpts());
                return list ?? new List<ActivityEntry>();
            }
            catch
            {
                return new List<ActivityEntry>();
            }
        }

        void Save(List<ActivityEntry> list)
        {
            var json = JsonSerializer.Serialize(list, JsonOpts());
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, json, new UTF8Encoding(false));
            if (File.Exists(_path)) File.Delete(_path);
            File.Move(tmp, _path);
        }

        static JsonSerializerOptions JsonOpts()
        {
            return new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
        }
    }
}
