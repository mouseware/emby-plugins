using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using MediaBrowser.Model.Entities;

namespace Claw.Emby.DefaultChapters.Core
{
    public class StoredChapter
    {
        public long StartPositionTicks { get; set; }
        public string Name { get; set; }
        public MarkerType MarkerType { get; set; }
        public string ImagePath { get; set; }
        public DateTimeOffset ImageDateModified { get; set; }

        public static StoredChapter From(ChapterInfo c)
        {
            return new StoredChapter
            {
                StartPositionTicks = c.StartPositionTicks,
                Name = c.Name,
                MarkerType = c.MarkerType,
                ImagePath = c.ImagePath,
                ImageDateModified = c.ImageDateModified
            };
        }

        public ChapterInfo ToChapterInfo()
        {
            return new ChapterInfo
            {
                StartPositionTicks = StartPositionTicks,
                Name = Name,
                MarkerType = MarkerType,
                ImagePath = ImagePath,
                ImageDateModified = ImageDateModified
            };
        }
    }

    /// <summary>One movie whose chapters this plugin replaced, plus the stash needed to undo it.</summary>
    public class OverrideRecord
    {
        public long InternalId { get; set; }
        public string ItemGuid { get; set; }
        public string Name { get; set; }
        public string Path { get; set; }
        public int? ProductionYear { get; set; }
        public DateTime ChangedUtc { get; set; }
        public int BeforeCount { get; set; }
        public int AfterCount { get; set; }
        public int IntervalMinutes { get; set; }
        /// <summary>Set when a library refresh found different chapters in the file and the stash was updated.</summary>
        public DateTime? OriginalUpdatedUtc { get; set; }
        public List<StoredChapter> Original { get; set; } = new List<StoredChapter>();
    }

    public class OverrideFile
    {
        public int Version { get; set; } = 1;
        public List<OverrideRecord> Overrides { get; set; } = new List<OverrideRecord>();
    }

    /// <summary>
    /// Plugin-owned JSON store, keyed by Emby's internal item id. Writes are atomic (temp file + move)
    /// and serialized with a lock; reads come from an in-memory copy.
    /// </summary>
    public class OverrideStore
    {
        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions { WriteIndented = true };
        private readonly object _lock = new object();
        private readonly string _path;
        private Dictionary<long, OverrideRecord> _items;

        public OverrideStore(string filePath)
        {
            _path = filePath;
        }

        public string FilePath => _path;

        private Dictionary<long, OverrideRecord> Items
        {
            get
            {
                if (_items == null)
                {
                    _items = Load();
                }
                return _items;
            }
        }

        private Dictionary<long, OverrideRecord> Load()
        {
            var map = new Dictionary<long, OverrideRecord>();
            if (!File.Exists(_path)) return map;

            var text = File.ReadAllText(_path, Encoding.UTF8);
            if (string.IsNullOrWhiteSpace(text)) return map;

            // A corrupt file must not be silently overwritten: it holds the only copy of the stashes.
            var file = JsonSerializer.Deserialize<OverrideFile>(text, JsonOptions) ?? new OverrideFile();
            foreach (var r in file.Overrides ?? new List<OverrideRecord>())
            {
                if (r != null && r.InternalId > 0)
                {
                    map[r.InternalId] = r;
                }
            }
            return map;
        }

        private void Save()
        {
            var dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var file = new OverrideFile { Overrides = _items.Values.OrderBy(r => r.InternalId).ToList() };
            var json = JsonSerializer.Serialize(file, JsonOptions);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, json, new UTF8Encoding(false));
            File.Move(tmp, _path, true);
        }

        public OverrideRecord Get(long internalId)
        {
            lock (_lock)
            {
                OverrideRecord r;
                return Items.TryGetValue(internalId, out r) ? r : null;
            }
        }

        public bool Contains(long internalId)
        {
            lock (_lock)
            {
                return Items.ContainsKey(internalId);
            }
        }

        public List<OverrideRecord> All()
        {
            lock (_lock)
            {
                return Items.Values.ToList();
            }
        }

        public void Upsert(OverrideRecord record)
        {
            if (record == null || record.InternalId <= 0) throw new ArgumentException("record");
            lock (_lock)
            {
                OverrideRecord previous;
                var had = Items.TryGetValue(record.InternalId, out previous);
                Items[record.InternalId] = record;
                try
                {
                    Save();
                }
                catch
                {
                    if (had) Items[record.InternalId] = previous; else Items.Remove(record.InternalId);
                    throw;
                }
            }
        }

        public bool Remove(long internalId)
        {
            lock (_lock)
            {
                OverrideRecord previous;
                if (!Items.TryGetValue(internalId, out previous)) return false;
                Items.Remove(internalId);
                try
                {
                    Save();
                }
                catch
                {
                    Items[internalId] = previous;
                    throw;
                }
                return true;
            }
        }
    }
}
