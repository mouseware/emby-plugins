using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Claw.Emby.MediaIntegrity.Core
{
    /// <summary>
    /// One-time import of the old get-all-hashes.ps1 database (tables files + hashes). The original is never opened:
    /// it is copied to a temp file, the copy is opened read-only, and the copy is deleted afterwards.
    /// Old times are local "yyyy-MM-dd HH:mm:ss" text and are converted to UTC.
    /// Paths that differ only by case are one file on Windows: they are merged (the most recently hashed row wins,
    /// the other row's history is attached to it).
    /// </summary>
    public static class LegacyImporter
    {
        public const string MetaKey = "legacy_import";

        public static ImportResult Import(IntegrityStore store, string legacyPath, string tempDir, DateTime nowUtc, TimeZoneInfo legacyZone = null)
        {
            var res = new ImportResult { Ran = true, Source = legacyPath, Time = nowUtc };
            var sw = Stopwatch.StartNew();
            legacyZone = legacyZone ?? TimeZoneInfo.Local;
            if (string.IsNullOrWhiteSpace(legacyPath) || !File.Exists(legacyPath)) { res.Error = "not found: " + legacyPath; return res; }
            Directory.CreateDirectory(tempDir);
            var copy = Path.Combine(tempDir, "legacy-import-" + Guid.NewGuid().ToString("N") + ".db");
            try
            {
                File.Copy(legacyPath, copy);
                File.SetAttributes(copy, FileAttributes.ReadOnly);
                List<Row> files, hashes;
                using (var src = new SqliteDb(copy, readOnly: true))
                {
                    files = src.Query("SELECT file_id, file_path, file_date, file_len, file_ext, file_hash FROM files");
                    hashes = src.Query("SELECT hash_id, file_id, hash_md5, hash_date, file_len, hash_time FROM hashes ORDER BY hash_date, hash_id");
                }
                res.SourceFiles = files.Count; res.SourceHashes = hashes.Count;
                var byFile = hashes.GroupBy(h => h.Long("file_id")).ToDictionary(g => g.Key, g => g.ToList());
                DateTime? Conv(string s)
                {
                    if (string.IsNullOrWhiteSpace(s)) return null;
                    if (!DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return null;
                    try { return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(d, DateTimeKind.Unspecified), legacyZone); }
                    catch (ArgumentException) { return DateTime.SpecifyKind(d.AddHours(-legacyZone.BaseUtcOffset.TotalHours), DateTimeKind.Utc); } // skipped DST hour
                }
                // newest-hashed first so it wins a case-insensitive path clash
                var ordered = files.OrderByDescending(f => byFile.TryGetValue(f.Long("file_id"), out var hs) ? hs.Max(h => h.Str("hash_date")) : "").ThenBy(f => f.Long("file_id")).ToList();

                store.Db.Transaction(() =>
                {
                    var byPath = new Dictionary<string, FileRecord>(StringComparer.OrdinalIgnoreCase);
                    foreach (var f in ordered)
                    {
                        var path = f.Str("file_path");
                        if (string.IsNullOrWhiteSpace(path)) continue;
                        var baseline = IntegrityStore.NormHash(f.Str("file_hash"));
                        var hs = byFile.TryGetValue(f.Long("file_id"), out var l) ? l : new List<Row>();
                        FileRecord rec;
                        bool merged = false;
                        if (byPath.TryGetValue(path, out rec)) { merged = true; res.CaseDuplicatesMerged++; }
                        else
                        {
                            var existing = store.GetFile(path);
                            if (existing != null) { res.AlreadyPresent++; continue; }
                            rec = new FileRecord
                            {
                                Path = path, Size = f.LongN("file_len"), BaselineMd5 = baseline, BaselineSize = f.LongN("file_len"),
                                Ext = f.Str("file_ext"), LegacyId = f.Long("file_id"), FirstSeen = Conv(f.Str("file_date"))
                            };
                            if (hs.Count == 0) { rec.Status = FileStatus.NeverHashed; rec.LastMd5 = null; } // old script stored file_hash but its history insert failed (apostrophe bug): keep it as an unverified baseline
                            else
                            {
                                var last = hs[hs.Count - 1];
                                rec.LastMd5 = IntegrityStore.NormHash(last.Str("hash_md5"));
                                rec.LastChecked = Conv(last.Str("hash_date"));
                                rec.LastSeen = rec.LastChecked;
                                rec.Size = last.LongN("file_len") ?? rec.Size;
                                rec.Status = rec.LastMd5 == baseline ? FileStatus.Ok : FileStatus.Changed;
                                rec.LastResult = rec.LastMd5 == baseline ? CheckResult.Legacy : CheckResult.LegacyDiffers;
                                var firstSame = hs.FirstOrDefault(h => IntegrityStore.NormHash(h.Str("hash_md5")) == baseline);
                                rec.BaselineDate = Conv((firstSame ?? hs[0]).Str("hash_date"));
                            }
                            store.InsertFile(rec);
                            byPath[path] = rec;
                            res.FilesImported++;
                            if (rec.Status == FileStatus.Ok) res.Ok++; else if (rec.Status == FileStatus.Changed) res.Changed++; else res.NeverHashed++;
                        }
                        bool hadMismatch = false;
                        foreach (var h in hs)
                        {
                            var md5 = IntegrityStore.NormHash(h.Str("hash_md5"));
                            var t = Conv(h.Str("hash_date")) ?? nowUtc;
                            if (md5 != baseline) hadMismatch = true;
                            store.AddCheck(new CheckRecord
                            {
                                FileId = rec.Id, Time = t, Md5 = md5, Size = h.LongN("file_len"), Seconds = h.LongN("hash_time"),
                                Result = md5 == rec.BaselineMd5 ? CheckResult.Legacy : CheckResult.LegacyDiffers, Source = "legacy",
                                Note = merged ? "merged from legacy row " + f.Long("file_id") + " (" + path + ")" : null
                            });
                            res.ChecksImported++;
                            if (res.OldestCheck == null || t < res.OldestCheck) res.OldestCheck = t;
                            if (res.NewestCheck == null || t > res.NewestCheck) res.NewestCheck = t;
                        }
                        if (hadMismatch && !merged) res.HistoricMismatches++;
                    }
                });
            }
            catch (Exception ex) { res.Error = ex.Message; }
            finally
            {
                try { if (File.Exists(copy)) { File.SetAttributes(copy, FileAttributes.Normal); File.Delete(copy); } } catch { }
                res.Seconds = sw.Elapsed.TotalSeconds;
            }
            return res;
        }
    }
}
