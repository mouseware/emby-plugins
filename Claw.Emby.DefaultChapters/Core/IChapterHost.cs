using System.Collections.Generic;
using MediaBrowser.Model.Entities;

namespace Claw.Emby.DefaultChapters.Core
{
    /// <summary>What the plugin needs to know about a library item.</summary>
    public class ItemRef
    {
        public long InternalId { get; set; }
        public string ItemGuid { get; set; }
        public string Name { get; set; }
        public string Path { get; set; }
        public int? ProductionYear { get; set; }
        public string TypeName { get; set; }
        /// <summary>True only for real feature movies (not trailers, extras, episodes, recordings, home videos).</summary>
        public bool IsMovie { get; set; }
        public long RunTimeTicks { get; set; }
    }

    /// <summary>
    /// Thin seam between the chapter logic and Emby. The real implementation talks to the library
    /// and item repository; the offline tests use an in-memory fake.
    /// </summary>
    public interface IChapterHost
    {
        ItemRef FindItem(string id);

        /// <summary>
        /// Eligible feature movies (see <see cref="ItemRef.IsMovie"/>) whose runtime is at least
        /// <paramref name="minRunTimeTicks"/>. Used by the manual "Found movies" scan only.
        /// </summary>
        IEnumerable<ItemRef> ListMovies(long minRunTimeTicks);

        /// <summary>All stored rows for the item: chapters and markers.</summary>
        List<ChapterInfo> GetChapters(ItemRef item);

        /// <summary>Full replace of the item's stored chapter rows, attaching chapter images where possible.</summary>
        void SaveChapters(ItemRef item, List<ChapterInfo> chapters, List<ChapterInfo> previous);

        /// <summary>Emby's localized "Chapter {0}" pattern for this item.</summary>
        string GetChapterNameFormat(ItemRef item);
    }
}
