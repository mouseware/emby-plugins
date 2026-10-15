using System;
using System.Collections.Generic;
using System.Linq;
using MediaBrowser.Model.Entities;

namespace Claw.Emby.DefaultChapters.Core
{
    public class DefaultChaptersException : Exception
    {
        public DefaultChaptersException(string message, int statusCode = 400) : base(message)
        {
            StatusCode = statusCode;
        }

        public int StatusCode { get; }
    }

    public class ItemStatus
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public bool IsMovie { get; set; }
        public bool HasOverride { get; set; }
        public int ChapterCount { get; set; }
        public int MarkerCount { get; set; }
        public bool LooksInterval { get; set; }
        public int DetectedIntervalMinutes { get; set; }
        public int IntervalMinutes { get; set; }
        public bool NeedsConfirm { get; set; }
        public string ConfirmReason { get; set; }
    }

    public class GenerateResult
    {
        public bool Changed { get; set; }
        public bool NeedsConfirm { get; set; }
        public string ConfirmReason { get; set; }
        public OverrideRow Row { get; set; }
    }

    public class RestoreResult
    {
        public bool Restored { get; set; }
        public bool Removed { get; set; }
        public int ChapterCount { get; set; }
        public string Message { get; set; }
    }

    /// <summary>A settings-table row: an override without the stashed chapter bodies.</summary>
    public class OverrideRow
    {
        public string Id { get; set; }
        public string ItemGuid { get; set; }
        public string Name { get; set; }
        public int? ProductionYear { get; set; }
        public string Path { get; set; }
        public string ChangedUtc { get; set; }
        public int BeforeCount { get; set; }
        public int AfterCount { get; set; }
        public int IntervalMinutes { get; set; }
        public string OriginalUpdatedUtc { get; set; }

        public static OverrideRow From(OverrideRecord r)
        {
            return new OverrideRow
            {
                Id = r.InternalId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ItemGuid = r.ItemGuid,
                Name = r.Name,
                ProductionYear = r.ProductionYear,
                Path = r.Path,
                ChangedUtc = DateTime.SpecifyKind(r.ChangedUtc, DateTimeKind.Utc).ToString("o"),
                BeforeCount = r.BeforeCount,
                AfterCount = r.AfterCount,
                IntervalMinutes = r.IntervalMinutes,
                OriginalUpdatedUtc = r.OriginalUpdatedUtc.HasValue ? DateTime.SpecifyKind(r.OriginalUpdatedUtc.Value, DateTimeKind.Utc).ToString("o") : null
            };
        }
    }

    /// <summary>
    /// Generate / restore / refresh re-apply. Emby access goes through <see cref="IChapterHost"/>.
    /// </summary>
    public class DefaultChaptersManager
    {
        private readonly IChapterHost _host;
        private readonly OverrideStore _store;
        private readonly Func<int> _configuredInterval;
        private readonly Action<string> _log;
        private readonly Func<DateTime> _clock;
        private readonly object _opLock = new object();

        public DefaultChaptersManager(IChapterHost host, OverrideStore store, Func<int> configuredInterval, Action<string> log = null, Func<DateTime> clock = null)
        {
            _host = host;
            _store = store;
            _configuredInterval = configuredInterval ?? (() => 5);
            _log = log ?? (s => { });
            _clock = clock ?? (() => DateTime.UtcNow);
        }

        public OverrideStore Store => _store;

        /// <summary>Plugin master switch (General tab). Off: Generate is refused and refreshes don't re-apply overrides.</summary>
        public Func<bool> IsEnabled { get; set; } = () => true;

        public const string DisabledMessage = "Default Chapters is switched off (plugin settings, General tab).";

        private void RequireEnabled()
        {
            if (!IsEnabled()) throw new DefaultChaptersException(DisabledMessage, 409);
        }

        public int ConfiguredInterval => ChapterGenerator.ClampInterval(_configuredInterval());

        public List<OverrideRow> GetRows()
        {
            return _store.All().OrderByDescending(r => r.ChangedUtc).Select(OverrideRow.From).ToList();
        }

        private ItemRef Require(string id)
        {
            var item = string.IsNullOrWhiteSpace(id) ? null : _host.FindItem(id);
            if (item == null) throw new DefaultChaptersException("Item not found.", 404);
            return item;
        }

        public ItemStatus GetStatus(string id)
        {
            var item = Require(id);
            var status = new ItemStatus
            {
                Id = item.InternalId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Name = item.Name,
                Type = item.TypeName,
                IsMovie = item.IsMovie,
                IntervalMinutes = ConfiguredInterval
            };
            if (!item.IsMovie) return status;

            var chapters = _host.GetChapters(item) ?? new List<ChapterInfo>();
            status.HasOverride = _store.Contains(item.InternalId);
            status.ChapterCount = ChapterGenerator.CountChapters(chapters);
            status.MarkerCount = chapters.Count(ChapterGenerator.IsMarker);
            status.DetectedIntervalMinutes = ChapterGenerator.DetectIntervalMinutes(chapters);
            status.LooksInterval = status.DetectedIntervalMinutes > 0;
            FillConfirm(status);
            return status;
        }

        private static void FillConfirm(ItemStatus s)
        {
            if (s.HasOverride)
            {
                s.NeedsConfirm = true;
                s.ConfirmReason = "This movie already has interval chapters from this plugin. Replace them with a new " + s.IntervalMinutes + "-minute set? The original chapters stay stashed for Restore.";
            }
            else if (s.LooksInterval)
            {
                s.NeedsConfirm = true;
                s.ConfirmReason = "This movie's " + s.ChapterCount + " chapters already look like a " + s.DetectedIntervalMinutes + "-minute interval set. Replace them with a " + s.IntervalMinutes + "-minute set anyway?";
            }
        }

        public GenerateResult Generate(string id, bool confirmed)
        {
            RequireEnabled();
            lock (_opLock)
            {
                var item = Require(id);
                if (!item.IsMovie)
                {
                    throw new DefaultChaptersException("Interval chapters are only available for movies (this item is " + (item.TypeName ?? "not a movie") + ").");
                }

                var status = GetStatus(id);
                if (status.NeedsConfirm && !confirmed)
                {
                    return new GenerateResult { NeedsConfirm = true, ConfirmReason = status.ConfirmReason };
                }

                var interval = ConfiguredInterval;
                if (item.RunTimeTicks < TimeSpan.FromMinutes(interval).Ticks)
                {
                    throw new DefaultChaptersException("This movie has no known runtime or is shorter than one " + interval + "-minute interval.");
                }

                var current = _host.GetChapters(item) ?? new List<ChapterInfo>();
                var existing = _store.Get(item.InternalId);
                var original = existing != null
                    ? existing.Original.Select(c => c.ToChapterInfo()).ToList()
                    : current;

                var markers = current.Where(ChapterGenerator.IsMarker).ToList();
                var built = ChapterGenerator.Build(item.RunTimeTicks, interval, markers, _host.GetChapterNameFormat(item));
                if (built == null)
                {
                    throw new DefaultChaptersException("Could not build chapters for this runtime.");
                }

                var record = new OverrideRecord
                {
                    InternalId = item.InternalId,
                    ItemGuid = item.ItemGuid,
                    Name = item.Name,
                    Path = item.Path,
                    ProductionYear = item.ProductionYear,
                    ChangedUtc = _clock(),
                    BeforeCount = existing != null ? existing.BeforeCount : ChapterGenerator.CountChapters(original),
                    AfterCount = ChapterGenerator.CountChapters(built),
                    IntervalMinutes = interval,
                    OriginalUpdatedUtc = existing?.OriginalUpdatedUtc,
                    Original = original.Select(StoredChapter.From).ToList()
                };

                // Stash first: if the chapter save fails we still hold the original, and the next
                // Generate keeps that stash instead of capturing a half-written state.
                _store.Upsert(record);
                _host.SaveChapters(item, built, current);
                _log("Generated " + record.AfterCount + " chapters every " + interval + " min for '" + item.Name + "' (" + item.InternalId + "), was " + record.BeforeCount);

                return new GenerateResult { Changed = true, Row = OverrideRow.From(record) };
            }
        }

        /// <summary>Hard ceiling on rows returned by one scan (the page pages through them).</summary>
        public const int MaxFindResults = 5000;

        /// <summary>Hard ceiling on items per bulk call (the page sends small batches).</summary>
        public const int MaxBulkItems = 200;

        /// <summary>
        /// Manual scan for the "Found movies" tab: eligible movies longer than MinRuntimeMinutes with at
        /// most MaxChapters chapter entries. Read-only.
        /// </summary>
        public FindResult Find(FindCriteria criteria)
        {
            var c = (criteria ?? new FindCriteria()).Normalized();
            var watch = System.Diagnostics.Stopwatch.StartNew();
            var minTicks = TimeSpan.FromMinutes(c.MinRuntimeMinutes).Ticks;
            var interval = ConfiguredInterval;
            var intervalTicks = TimeSpan.FromMinutes(interval).Ticks;
            var found = new List<FoundMovie>();
            var scanned = 0;
            var matches = 0;

            foreach (var item in _host.ListMovies(minTicks) ?? Enumerable.Empty<ItemRef>())
            {
                if (item == null || !item.IsMovie) continue;
                if (item.RunTimeTicks <= 0 || item.RunTimeTicks <= minTicks) continue; // "longer than"
                scanned++;

                var hasOverride = _store.Contains(item.InternalId);
                if (hasOverride && c.ExcludeOverridden) continue;

                var chapters = _host.GetChapters(item) ?? new List<ChapterInfo>();
                var count = ChapterGenerator.CountChapters(chapters);
                if (count > c.MaxChapters) continue;

                matches++;
                if (found.Count >= MaxFindResults) continue;

                var status = new ItemStatus
                {
                    HasOverride = hasOverride,
                    ChapterCount = count,
                    DetectedIntervalMinutes = ChapterGenerator.DetectIntervalMinutes(chapters),
                    IntervalMinutes = interval
                };
                status.LooksInterval = status.DetectedIntervalMinutes > 0;
                FillConfirm(status);

                found.Add(new FoundMovie
                {
                    Id = item.InternalId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ItemGuid = item.ItemGuid,
                    Name = item.Name,
                    ProductionYear = item.ProductionYear,
                    Path = item.Path,
                    RunTimeTicks = item.RunTimeTicks,
                    ChapterCount = count,
                    MarkerCount = chapters.Count(ChapterGenerator.IsMarker),
                    HasOverride = hasOverride,
                    LooksInterval = status.LooksInterval,
                    DetectedIntervalMinutes = status.DetectedIntervalMinutes,
                    NeedsConfirm = status.NeedsConfirm,
                    ConfirmReason = status.ConfirmReason,
                    CanGenerate = item.RunTimeTicks >= intervalTicks
                });
            }

            watch.Stop();
            _log("Found-movies scan: " + matches + " match(es) of " + scanned + " movie(s) longer than " + c.MinRuntimeMinutes +
                 " min with <= " + c.MaxChapters + " chapter(s), " + watch.ElapsedMilliseconds + " ms");
            return new FindResult
            {
                Criteria = c,
                IntervalMinutes = interval,
                ScannedCount = scanned,
                MatchCount = matches,
                Truncated = matches > found.Count,
                ElapsedMs = watch.ElapsedMilliseconds,
                Items = found.OrderBy(f => f.Name ?? string.Empty, StringComparer.OrdinalIgnoreCase).ToList()
            };
        }

        /// <summary>
        /// Bulk Generate for the "Found movies" tab. Each id goes through the same <see cref="Generate"/>
        /// path as the item menu (stash once, markers kept, confirm rule). One failure does not stop the rest.
        /// </summary>
        public BulkGenerateResult GenerateMany(IEnumerable<string> ids, bool confirmed)
        {
            RequireEnabled();
            var list = (ids ?? Enumerable.Empty<string>())
                .Where(i => !string.IsNullOrWhiteSpace(i))
                .Select(i => i.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (list.Count == 0) throw new DefaultChaptersException("No items selected.");
            if (list.Count > MaxBulkItems) throw new DefaultChaptersException("Too many items in one request (max " + MaxBulkItems + ").");

            var result = new BulkGenerateResult { Results = new List<BulkItemResult>() };
            foreach (var id in list)
            {
                var r = new BulkItemResult { Id = id };
                try
                {
                    var item = _host.FindItem(id);
                    r.Name = item?.Name;
                    var g = Generate(id, confirmed);
                    r.Changed = g.Changed;
                    r.NeedsConfirm = g.NeedsConfirm;
                    r.ConfirmReason = g.ConfirmReason;
                    r.Row = g.Row;
                }
                catch (DefaultChaptersException ex)
                {
                    r.Error = ex.Message;
                }
                catch (Exception ex)
                {
                    r.Error = "Unexpected error: " + ex.Message;
                    _log("Bulk generate failed for " + id + ": " + ex);
                }

                if (r.Changed) result.ChangedCount++;
                else if (r.NeedsConfirm) result.NeedsConfirmCount++;
                else result.FailedCount++;
                result.Results.Add(r);
            }
            return result;
        }

        public RestoreResult Restore(string id)
        {
            lock (_opLock)
            {
                var item = string.IsNullOrWhiteSpace(id) ? null : _host.FindItem(id);
                long internalId;
                if (item != null)
                {
                    internalId = item.InternalId;
                }
                else if (!long.TryParse(id, out internalId))
                {
                    throw new DefaultChaptersException("Item not found.", 404);
                }

                var record = _store.Get(internalId);
                if (record == null)
                {
                    throw new DefaultChaptersException("No stashed chapters for this item.", 404);
                }

                if (item == null)
                {
                    // The movie is gone from the library: nothing to write back, just drop the row.
                    _store.Remove(internalId);
                    _log("Removed override row for missing item " + internalId);
                    return new RestoreResult { Removed = true, Message = "Item is no longer in the library; row removed." };
                }

                var current = _host.GetChapters(item) ?? new List<ChapterInfo>();
                var original = record.Original.Select(c => c.ToChapterInfo()).ToList();

                // Chapters come from the stash; markers come from both the stash and today's
                // database so intro/credits detection that ran after Generate is kept.
                var markers = ChapterGenerator.MergeMarkers(current.Where(ChapterGenerator.IsMarker), original.Where(ChapterGenerator.IsMarker), item.RunTimeTicks);
                var restored = original.Where(c => !ChapterGenerator.IsMarker(c)).ToList();
                restored.AddRange(markers);
                restored = ChapterGenerator.Order(restored);

                _host.SaveChapters(item, restored, original);
                _store.Remove(internalId);
                _log("Restored " + ChapterGenerator.CountChapters(restored) + " original chapters for '" + item.Name + "' (" + internalId + ")");
                return new RestoreResult { Restored = true, Removed = true, ChapterCount = ChapterGenerator.CountChapters(restored) };
            }
        }

        /// <summary>
        /// Called from the metadata provider after Emby re-read the file and before it saves chapters.
        /// Returns the list Emby should save instead, or null to leave Emby's result alone.
        /// </summary>
        public List<ChapterInfo> ApplyOnRefresh(ItemRef item, List<ChapterInfo> probed)
        {
            if (!IsEnabled()) return null;
            if (item == null || !item.IsMovie) return null;
            if (probed == null) return null; // Emby is not going to touch chapters on this refresh.

            var record = _store.Get(item.InternalId);
            if (record == null) return null;

            lock (_opLock)
            {
                var stored = _host.GetChapters(item) ?? new List<ChapterInfo>();
                var markers = ChapterGenerator.MergeMarkers(probed.Where(ChapterGenerator.IsMarker), stored.Where(ChapterGenerator.IsMarker), item.RunTimeTicks);
                var built = ChapterGenerator.Build(item.RunTimeTicks, record.IntervalMinutes, markers, _host.GetChapterNameFormat(item));
                if (built == null)
                {
                    _log("Refresh: '" + item.Name + "' runtime is now shorter than one interval; leaving Emby's chapters.");
                    return null;
                }

                var original = record.Original.Select(c => c.ToChapterInfo()).ToList();
                var changed = false;
                var probedChapters = probed.Where(c => !ChapterGenerator.IsMarker(c)).ToList();
                if (!ChapterGenerator.SameChapterPositions(probedChapters, original) &&
                    !ChapterGenerator.SameChapterPositions(probedChapters, built))
                {
                    // The file itself now reports different chapters (replaced or remuxed):
                    // that becomes the version Restore goes back to.
                    record.Original = probed.Select(StoredChapter.From).ToList();
                    record.BeforeCount = ChapterGenerator.CountChapters(probed);
                    record.OriginalUpdatedUtc = _clock();
                    changed = true;
                }

                var after = ChapterGenerator.CountChapters(built);
                if (after != record.AfterCount)
                {
                    record.AfterCount = after;
                    changed = true;
                }
                if (!string.IsNullOrEmpty(item.Name) && item.Name != record.Name)
                {
                    record.Name = item.Name;
                    changed = true;
                }
                if (changed) _store.Upsert(record);

                _log("Refresh: re-applied " + after + " interval chapters to '" + item.Name + "' (" + item.InternalId + ")");
                return built;
            }
        }
    }
}
