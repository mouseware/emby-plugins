using System;
using System.Threading;
using System.Threading.Tasks;
using Claw.Emby.DefaultChapters.Core;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Logging;

namespace Claw.Emby.DefaultChapters.Providers
{
    /// <summary>
    /// Refresh hook. Emby runs non-pre-refresh custom providers after the media-info probe has filled
    /// result.Chapters and before MetadataService.SaveItem writes them, so swapping the list here makes
    /// Emby save our interval chapters instead. Movies without an override are never touched.
    /// IForcedProvider keeps it running for items with locked metadata.
    /// </summary>
    public class IntervalChapterProvider : ICustomMetadataProvider<Movie>, IForcedProvider, IHasOrder
    {
        private readonly ILibraryManager _libraryManager;
        private readonly IFileSystem _fileSystem;
        private readonly ILogManager _logManager;
        private readonly ILogger _logger;

        public IntervalChapterProvider(ILibraryManager libraryManager, IFileSystem fileSystem, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _fileSystem = fileSystem;
            _logManager = logManager;
            _logger = logManager.GetLogger("DefaultChapters");
        }

        public string Name => "Default Chapters (interval chapter overrides)";

        /// <summary>Run after other custom providers.</summary>
        public int Order => 10000;

        public Task<ItemUpdateType> FetchAsync(MetadataResult<Movie> itemResult, MetadataRefreshOptions options, LibraryOptions libraryOptions, CancellationToken cancellationToken)
        {
            try
            {
                if (itemResult == null || itemResult.Item == null || itemResult.Chapters == null)
                {
                    return Task.FromResult(ItemUpdateType.None);
                }

                var manager = Plugin.GetManager(_libraryManager, _fileSystem, _logManager);
                if (!manager.Store.Contains(itemResult.Item.InternalId))
                {
                    return Task.FromResult(ItemUpdateType.None);
                }

                var item = Plugin.Host.ToRef(itemResult.Item);
                var replacement = manager.ApplyOnRefresh(item, itemResult.Chapters);
                if (replacement != null)
                {
                    itemResult.Chapters = replacement;
                }
            }
            catch (Exception ex)
            {
                _logger.ErrorException("Default Chapters: refresh re-apply failed for {0}", ex, itemResult?.Item?.Name);
            }
            return Task.FromResult(ItemUpdateType.None);
        }
    }
}
