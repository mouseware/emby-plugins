using System;
using System.Collections.Generic;
using Claw.Emby.CustomItemUI.Api;

class Program
{
    static int P, F;
    static void Ok(bool c, string m)
    {
        Console.WriteLine((c ? "PASS " : "FAIL ") + m);
        if (c) P++; else F++;
    }

    static OwnedTitle M(string id, string name, int year, string imdb, string tmdb, string type = "Movie") =>
        new OwnedTitle { Id = id, Name = name, Year = year, Imdb = imdb, Tmdb = tmdb, Type = type };

    static TrailerInfo T(string id, string name, int? year, string imdb, string tmdb, bool extra = false) =>
        new TrailerInfo { Id = id, Name = name, Year = year, Imdb = imdb, Tmdb = tmdb, IsLibraryExtra = extra };

    static int Main()
    {
        Ok(TrailerIndex.NormTitle("The Silence of the Lambs (1991)") == "silence of the lambs", "norm: strip year and leading The");
        Ok(TrailerIndex.NormTitle("Carlito's Way") == "carlito s way", "norm: punctuation");
        Ok(TrailerIndex.NormId("  tt123  ") == "tt123" && TrailerIndex.NormId("") == null, "norm id");

        var ix = TrailerIndex.Build(new[]
        {
            M("m1", "The Silence of the Lambs", 1991, "tt0102926", "274"),
            M("m2", "Bambi", 1942, "tt0034492", "3170"),
            M("m3", "Clash of IDs", 1999, "tt0000001", "1"),
            M("s1", "Succession", 2018, "tt7660850", "100", "Series"),
            M("m4", "Only Year", 2001, null, null)
        });

        var a = ix.Match(T("t1", "Some Trailer", 1991, "tt0102926", "999"));
        Ok(a != null && a.Owned.Id == "m1" && a.How == "imdb", "IMDb wins even if TMDb differs");

        var b = ix.Match(T("t2", "Other", 1942, null, "3170"));
        Ok(b != null && b.Owned.Id == "m2" && b.How == "tmdb", "TMDb when IMDb missing");

        var c = ix.Match(T("t3", "The Silence of the Lambs", 1991, null, null));
        Ok(c != null && c.Owned.Id == "m1" && c.How == "title-year", "title+year fallback");

        var d = ix.Match(T("t4", "Silence of the Lambs", 1991, null, null));
        Ok(d != null && d.How == "title-year", "title without leading The still matches");

        var e = ix.Match(T("t5", "Unowned Flick", 2024, "tt9999999", "999999"));
        Ok(e == null, "unowned title stays unmatched");

        var f = ix.Match(T("t6", "Bambi", 1942, "tt0034492", "3170", extra: true));
        Ok(f == null, "library extra is not swapped");

        var g = ix.Match(T("t7", "Succession", 2018, "tt7660850", null));
        Ok(g != null && g.Owned.Type == "Series" && g.How == "imdb", "series matched by IMDb");

        var h = ix.Match(T("t8", "Only Year", 2001, null, null));
        Ok(h != null && h.Owned.Id == "m4" && h.How == "title-year", "title+year with no providers");

        var i = ix.Match(T("t9", "Clash of IDs", 1999, null, "100"));
        Ok(i != null && i.Owned.Id == "s1" && i.How == "tmdb", "TMDb movie miss falls through to series");

        var trailers = new List<TrailerInfo>
        {
            T("t1", "The Silence of the Lambs", 1991, "tt0102926", "274"),
            T("t2", "Bambi", 1942, null, "3170"),
            T("t3", "Only Year", 2001, null, null),
            T("tX", "Nope", 1990, "tt0000", null),
            T("tE", "Bambi", 1942, "tt0034492", "3170", extra: true)
        };
        int n = ix.CountMatches(trailers, out var considered, out var extras, out var imdb, out var tmdb, out var title);
        Ok(n == 3 && considered == 4 && extras == 1 && imdb == 1 && tmdb == 1 && title == 1, $"counts n={n} c={considered} e={extras} imdb={imdb} tmdb={tmdb} title={title}");

        Console.WriteLine(P + " passed, " + F + " failed");
        return F == 0 ? 0 : 1;
    }
}
