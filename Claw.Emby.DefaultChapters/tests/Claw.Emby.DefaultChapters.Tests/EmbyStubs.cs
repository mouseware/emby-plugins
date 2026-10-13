// Same-shape stand-ins for the two Emby 4.10 model types the plugin core uses
// (MediaBrowser.Model.Entities.ChapterInfo / MarkerType). Test-only.
using System;

namespace MediaBrowser.Model.Entities
{
    public enum MarkerType
    {
        Chapter,
        IntroStart,
        IntroEnd,
        CreditsStart
    }

    public class ChapterInfo
    {
        public long StartPositionTicks { get; set; }
        public string Name { get; set; }
        public string ImageTag { get; set; }
        public MarkerType MarkerType { get; set; }
        public string ImagePath { get; set; }
        public DateTimeOffset ImageDateModified { get; set; }
        public int ChapterIndex { get; set; }
    }
}
