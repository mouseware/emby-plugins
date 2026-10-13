using System;
using System.Collections.Generic;
using Claw.Emby.DefaultChapters.Core;
using MediaBrowser.Common.Extensions;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Services;

namespace Claw.Emby.DefaultChapters.Api
{
    [Route("/DefaultChapters/Overrides", "GET", Summary = "Default Chapters: movies whose chapters were replaced (no chapter bodies)")]
    [Authenticated(Roles = "Admin")]
    public class GetDefaultChapterOverrides : IReturn<OverridesResult>
    {
    }

    [Route("/DefaultChapters/Items/{Id}/Status", "GET", Summary = "Default Chapters: whether the item is eligible, overridden, or already looks like an interval set")]
    [Authenticated(Roles = "Admin")]
    public class GetDefaultChapterStatus : IReturn<ItemStatus>
    {
        [ApiMember(Name = "Id", Description = "Item Id", IsRequired = true, DataType = "string", ParameterType = "path", Verb = "GET")]
        public string Id { get; set; }
    }

    [Route("/DefaultChapters/Items/{Id}/Generate", "POST", Summary = "Default Chapters: replace the movie's chapters with interval chapters (stashes the originals once)")]
    [Authenticated(Roles = "Admin")]
    public class PostDefaultChapterGenerate : IReturn<GenerateResult>
    {
        [ApiMember(Name = "Id", Description = "Item Id", IsRequired = true, DataType = "string", ParameterType = "path", Verb = "POST")]
        public string Id { get; set; }

        /// <summary>Required when Status.NeedsConfirm is true; otherwise the call returns NeedsConfirm and changes nothing.</summary>
        [ApiMember(Name = "Confirmed", Description = "Confirm replacing an existing override or interval-looking set", IsRequired = false, DataType = "boolean", ParameterType = "query", Verb = "POST")]
        public bool Confirmed { get; set; }
    }

    [Route("/DefaultChapters/Items/{Id}/Restore", "POST", Summary = "Default Chapters: put the stashed original chapters back and drop the override")]
    [Authenticated(Roles = "Admin")]
    public class PostDefaultChapterRestore : IReturn<RestoreResult>
    {
        [ApiMember(Name = "Id", Description = "Item Id", IsRequired = true, DataType = "string", ParameterType = "path", Verb = "POST")]
        public string Id { get; set; }
    }

    [Route("/DefaultChapters/Found", "GET", Summary = "Default Chapters: manual scan for movies longer than N minutes with few chapters (read-only)")]
    [Authenticated(Roles = "Admin")]
    public class GetDefaultChapterFound : IReturn<FindResult>
    {
        [ApiMember(Name = "MinRuntimeMinutes", Description = "Only movies longer than this (default: plugin setting, 60)", IsRequired = false, DataType = "int", ParameterType = "query", Verb = "GET")]
        public int? MinRuntimeMinutes { get; set; }

        [ApiMember(Name = "MaxChapters", Description = "Only movies with this many chapters or fewer (default: plugin setting, 3)", IsRequired = false, DataType = "int", ParameterType = "query", Verb = "GET")]
        public int? MaxChapters { get; set; }

        [ApiMember(Name = "ExcludeOverridden", Description = "Hide movies that already have an override (default: plugin setting, true)", IsRequired = false, DataType = "boolean", ParameterType = "query", Verb = "GET")]
        public bool? ExcludeOverridden { get; set; }
    }

    [Route("/DefaultChapters/GenerateMany", "POST", Summary = "Default Chapters: Generate for several movies (same rules as the single Generate)")]
    [Authenticated(Roles = "Admin")]
    public class PostDefaultChapterGenerateMany : IReturn<BulkGenerateResult>
    {
        [ApiMember(Name = "Ids", Description = "Comma-separated item ids (max 200)", IsRequired = true, DataType = "string", ParameterType = "query", Verb = "POST")]
        public string Ids { get; set; }

        [ApiMember(Name = "Confirmed", Description = "Replace existing overrides / interval-looking sets without asking per item", IsRequired = false, DataType = "boolean", ParameterType = "query", Verb = "POST")]
        public bool Confirmed { get; set; }
    }

    public class OverridesResult
    {
        public int IntervalMinutes { get; set; }
        public List<OverrideRow> Items { get; set; }
    }

    public class DefaultChaptersService : IService, IRequiresRequest
    {
        private readonly ILibraryManager _libraryManager;
        private readonly IFileSystem _fileSystem;
        private readonly ILogManager _logManager;

        public DefaultChaptersService(ILibraryManager libraryManager, IFileSystem fileSystem, ILogManager logManager)
        {
            _libraryManager = libraryManager;
            _fileSystem = fileSystem;
            _logManager = logManager;
        }

        public IRequest Request { get; set; }

        private DefaultChaptersManager Manager => Plugin.GetManager(_libraryManager, _fileSystem, _logManager);

        private static T Run<T>(Func<T> action)
        {
            try
            {
                return action();
            }
            catch (DefaultChaptersException ex)
            {
                if (ex.StatusCode == 404) throw new ResourceNotFoundException(ex.Message);
                throw new ArgumentException(ex.Message);
            }
        }

        public object Get(GetDefaultChapterOverrides request)
        {
            return new OverridesResult { IntervalMinutes = Manager.ConfiguredInterval, Items = Manager.GetRows() };
        }

        public object Get(GetDefaultChapterStatus request)
        {
            return Run(() => Manager.GetStatus(request.Id));
        }

        public object Post(PostDefaultChapterGenerate request)
        {
            return Run(() => Manager.Generate(request.Id, request.Confirmed));
        }

        public object Get(GetDefaultChapterFound request)
        {
            var cfg = Plugin.Instance?.Configuration ?? new PluginConfiguration();
            var criteria = new FindCriteria
            {
                MinRuntimeMinutes = request.MinRuntimeMinutes ?? cfg.MinRuntimeMinutes,
                MaxChapters = request.MaxChapters ?? cfg.MaxChapters,
                ExcludeOverridden = request.ExcludeOverridden ?? cfg.ExcludeOverridden
            };
            return Run(() => Manager.Find(criteria));
        }

        public object Post(PostDefaultChapterGenerateMany request)
        {
            var ids = (request.Ids ?? string.Empty).Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            return Run(() => Manager.GenerateMany(ids, request.Confirmed));
        }

        public object Post(PostDefaultChapterRestore request)
        {
            return Run(() => Manager.Restore(request.Id));
        }
    }
}
