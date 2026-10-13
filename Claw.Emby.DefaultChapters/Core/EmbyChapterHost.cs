using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Logging;

namespace Claw.Emby.DefaultChapters.Core
{
    /// <summary>Real <see cref="IChapterHost"/>: Emby's library manager and item repository.</summary>
    public class EmbyChapterHost : IChapterHost
    {
        private static readonly string[] AllowedCollectionTypes = { "movies", "" };

        private readonly ILibraryManager _libraryManager;
        private readonly IFileSystem _fileSystem;
        private readonly ILogger _logger;

        public EmbyChapterHost(ILibraryManager libraryManager, IFileSystem fileSystem, ILogger logger)
        {
            _libraryManager = libraryManager;
            _fileSystem = fileSystem;
            _logger = logger;
        }

        public BaseItem FindBaseItem(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            long internalId;
            if (long.TryParse(id, out internalId)) return _libraryManager.GetItemById(internalId);
            Guid guid;
            if (Guid.TryParse(id, out guid)) return _libraryManager.GetItemById(guid);
            return null;
        }

        public ItemRef FindItem(string id)
        {
            var item = FindBaseItem(id);
            return item == null ? null : ToRef(item);
        }

        public IEnumerable<ItemRef> ListMovies(long minRunTimeTicks)
        {
            var query = new InternalItemsQuery
            {
                IncludeItemTypes = new[] { "Movie" },
                Recursive = true,
                IsVirtualItem = false,
                MinRunTimeTicks = minRunTimeTicks > 0 ? minRunTimeTicks : (long?)null
            };
            var items = _libraryManager.GetItemList(query) ?? Array.Empty<BaseItem>();
            foreach (var item in items)
            {
                if (item == null || !IsEligibleMovie(item)) continue;
                yield return ToRef(item, true);
            }
        }

        public ItemRef ToRef(BaseItem item)
        {
            return ToRef(item, IsEligibleMovie(item));
        }

        private static ItemRef ToRef(BaseItem item, bool eligible)
        {
            return new ItemRef
            {
                InternalId = item.InternalId,
                ItemGuid = item.Id.ToString("N"),
                Name = item.Name,
                Path = item.Path,
                ProductionYear = item.ProductionYear,
                TypeName = item.GetType().Name,
                IsMovie = eligible,
                RunTimeTicks = item.RunTimeTicks ?? 0
            };
        }

        /// <summary>Feature movies in a Movies (or mixed) library only.</summary>
        public bool IsEligibleMovie(BaseItem item)
        {
            if (!(item is Movie)) return false;
            if (item.ExtraType.HasValue || item.IsVirtualItem) return false;
            try
            {
                if (item.IsActiveRecording()) return false;
                var folders = _libraryManager.GetCollectionFolders(item);
                foreach (var f in folders ?? Array.Empty<Folder>())
                {
                    var cf = f as CollectionFolder;
                    var type = (cf == null ? null : cf.CollectionType) ?? string.Empty;
                    if (!AllowedCollectionTypes.Contains(type, StringComparer.OrdinalIgnoreCase)) return false;
                }
            }
            catch (Exception ex)
            {
                _logger.ErrorException("Default Chapters: could not inspect libraries of {0}", ex, item.Name);
                return false;
            }
            return true;
        }

        public List<ChapterInfo> GetChapters(ItemRef item)
        {
            var baseItem = _libraryManager.GetItemById(item.InternalId);
            if (baseItem == null) return new List<ChapterInfo>();
            return BaseItem.ItemRepository.GetChapters(baseItem) ?? new List<ChapterInfo>();
        }

        public string GetChapterNameFormat(ItemRef item)
        {
            try
            {
                var baseItem = _libraryManager.GetItemById(item.InternalId);
                var lang = baseItem == null ? null : baseItem.GetPreferredMetadataLanguage();
                var text = BaseItem.LocalizationManager.GetLocalizedString("ChapterNameValue", lang);
                if (!string.IsNullOrWhiteSpace(text) && text.IndexOf("{0}", StringComparison.Ordinal) >= 0) return text;
            }
            catch (Exception ex)
            {
                _logger.Debug("Default Chapters: localized chapter name unavailable: {0}", ex.Message);
            }
            return ChapterGenerator.DefaultNameFormat;
        }

        public void SaveChapters(ItemRef item, List<ChapterInfo> chapters, List<ChapterInfo> previous)
        {
            var video = _libraryManager.GetItemById(item.InternalId) as Video;
            if (video == null) throw new DefaultChaptersException("Item is not a video.");

            AttachImages(video, chapters, previous);
            BaseItem.ItemRepository.SaveChapters(video.InternalId, false, chapters);
        }

        /// <summary>
        /// Ask Emby to attach chapter images without extracting anything (in thumbnail-set mode this
        /// points every chapter at the item's thumbnail set). If that leaves no images, reuse a shared
        /// thumbnail-set path from the previous chapters.
        /// </summary>
        private void AttachImages(Video video, List<ChapterInfo> chapters, List<ChapterInfo> previous)
        {
            try
            {
                var ct = CancellationToken.None;
                var folders = _libraryManager.GetCollectionFolders(video, ct);
                BaseItem[] folderItems = folders;
                var libraryOptions = _libraryManager.GetLibraryOptions(video, folderItems, ct);
                var source = BaseItem.MediaSourceManager.GetStaticMediaSources(video, false, false, true, false, folderItems, libraryOptions, null, null, ct).FirstOrDefault();
                if (source != null)
                {
                    var videoStream = source.MediaStreams == null ? null : source.MediaStreams.FirstOrDefault(s => s.Type == MediaStreamType.Video);
                    var options = new MetadataRefreshOptions(_fileSystem)
                    {
                        EnableThumbnailImageExtraction = false,
                        ReplaceThumbnailImages = false
                    };
                    _libraryManager.RefreshThumbnailImages(video, source, videoStream, libraryOptions, options, chapters,
                        false, false, false, ct).GetAwaiter().GetResult();
                }
            }
            catch (Exception ex)
            {
                _logger.ErrorException("Default Chapters: Emby could not attach chapter images for {0}; trying fallback", ex, video.Name);
            }

            if (chapters.Any(c => !string.IsNullOrEmpty(c.ImagePath))) return;

            var shared = ChapterGenerator.SharedImageSource(previous);
            if (shared == null) return;
            foreach (var c in chapters)
            {
                c.ImagePath = shared.ImagePath;
                c.ImageDateModified = shared.ImageDateModified;
            }
        }
    }
}
