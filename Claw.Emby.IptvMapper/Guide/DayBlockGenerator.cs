using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Claw.Emby.IptvMapper.Guide
{
    /// <summary>One whole-day guide block: local midnight to the next local midnight.</summary>
    public sealed class DayBlock
    {
        public string Id { get; set; }
        public DateTime LocalDate { get; set; }
        public DateTimeOffset StartUtc { get; set; }
        public DateTimeOffset EndUtc { get; set; }
        public TimeSpan Duration => EndUtc - StartUtc;
    }

    /// <summary>Pure, dependency-free generation logic (unit-tested outside Emby).</summary>
    public static class DayBlockGenerator
    {
        /// <summary>
        /// Blocks for every local calendar day in <paramref name="tz"/> that overlaps [startUtc, endUtc).
        /// DST days are 23 or 25 hours long. Ids are deterministic per channel + local date.
        /// </summary>
        public static List<DayBlock> Build(string listingChannelId, DateTimeOffset startUtc, DateTimeOffset endUtc, TimeZoneInfo tz)
        {
            if (tz == null) throw new ArgumentNullException(nameof(tz));
            var list = new List<DayBlock>();
            if (endUtc <= startUtc) return list;

            var firstDay = TimeZoneInfo.ConvertTime(startUtc, tz).Date;
            var lastDay = TimeZoneInfo.ConvertTime(endUtc, tz).Date;
            var hash = ShortHash(listingChannelId ?? string.Empty);

            for (var day = firstDay; day <= lastDay; day = day.AddDays(1))
            {
                var s = LocalMidnightUtc(day, tz);
                var e = LocalMidnightUtc(day.AddDays(1), tz);
                if (e <= startUtc || s >= endUtc || e <= s) continue;
                list.Add(new DayBlock
                {
                    Id = "cng" + day.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + "_" + hash,
                    LocalDate = day,
                    StartUtc = s,
                    EndUtc = e
                });
            }

            return list;
        }

        /// <summary>UTC instant of local midnight. Handles zones whose DST change happens at midnight
        /// (invalid local time: first valid instant after it; ambiguous: the earlier instant).</summary>
        public static DateTimeOffset LocalMidnightUtc(DateTime localDate, TimeZoneInfo tz)
        {
            var local = DateTime.SpecifyKind(localDate.Date, DateTimeKind.Unspecified);
            for (var i = 0; i < 16 && tz.IsInvalidTime(local); i++)
            {
                local = local.AddMinutes(15);
            }

            if (tz.IsAmbiguousTime(local))
            {
                var max = TimeSpan.MinValue;
                foreach (var o in tz.GetAmbiguousTimeOffsets(local))
                {
                    if (o > max) max = o;
                }

                return new DateTimeOffset(DateTime.SpecifyKind(local - max, DateTimeKind.Utc), TimeSpan.Zero);
            }

            return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, tz), TimeSpan.Zero);
        }

        public static string ShortHash(string s)
        {
            using (var sha = SHA1.Create())
            {
                var b = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder(16);
                for (var i = 0; i < 8; i++) sb.Append(b[i].ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }
    }
}
