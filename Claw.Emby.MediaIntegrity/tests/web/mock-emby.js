// Offline stand-in for Emby's web client + the Media Integrity API. Fake data only.
(function () {
  var now = Date.now(), H = 3600e3, D = 864e5;
  function iso(ms) { return new Date(now - ms).toISOString(); }
  function md5(i) { var h = ""; for (var k = 0; k < 32; k++) h += "0123456789ABCDEF"[(i * 7 + k * 13 + (i >> 2) * k) % 16]; return h; }
  var libs = [
    { Id: "101", Name: "Movies", Type: "movies", Locations: ["D:\\Media\\Movies"], Included: true },
    { Id: "102", Name: "TV Shows", Type: "tvshows", Locations: ["D:\\Media\\TV"], Included: true },
    { Id: "103", Name: "Home Videos", Type: "homevideos", Locations: ["E:\\Family\\Videos"], Included: true },
    { Id: "104", Name: "Audio books", Type: "audiobooks", Locations: ["F:\\Books"], Included: true }
  ];
  var movies = ["Big Buck Bunny (2008)", "Sintel (2010)", "Tears of Steel (2012)", "Elephants Dream (2006)", "Cosmos Laundromat (2015)", "Spring (2019)", "Agent 327 (2017)", "Caminandes (2013)", "Glass Half (2015)", "Hero (2018)", "Coffee Run (2020)", "Sprite Fright (2021)", "Charge (2022)", "Wing It! (2023)"];
  var files = [], id = 0;
  function add(path, size, st, o) {
    var i = ++id, parts = path.split("\\"), name = parts.pop();
    var f = { Id: i, Path: path, Name: name, Folder: parts.join("\\"), Size: size, Hash: md5(i), LastHash: md5(i), LastChecked: iso((i % 40) * D + 3 * H), BaselineDate: iso(400 * D), Status: st, LastResult: "match", Ignored: false, Error: null, Mtime: iso(500 * D) };
    f.Ext = name.indexOf(".") < 0 ? "" : name.split(".").pop().toLowerCase();
    for (var k in (o || {})) f[k] = o[k];
    if (st === "changed" || st === "modified") f.LastHash = md5(i + 999);
    files.push(f); return f;
  }
  movies.forEach(function (m, i) {
    add("D:\\Media\\Movies\\" + m + "\\" + m + " [Bluray-1080p].mkv", Math.round((3 + i * 1.7) * 1073741824), "ok");
    add("D:\\Media\\Movies\\" + m + "\\" + m + ".nfo", 2400 + i * 37, "ok");
    add("D:\\Media\\Movies\\" + m + "\\poster.jpg", 412000 + i * 900, "ok");
  });
  for (var s = 1; s <= 3; s++) for (var e = 1; e <= 10; e++) add("D:\\Media\\TV\\Example Show\\Season 0" + s + "\\Example Show - S0" + s + "E" + (e < 10 ? "0" + e : e) + " - Episode " + e + ".mkv", (900 + e * 37 + s * 11) * 1048576, "ok");
  for (var e2 = 1; e2 <= 8; e2++) add("D:\\Media\\TV\\The Sample Series\\Season 01\\The Sample Series - S01E0" + e2 + ".mp4", (620 + e2 * 19) * 1048576, "ok");
  for (var v = 1; v <= 9; v++) add("E:\\Family\\Videos\\2024\\Trip day " + v + ".mov", (2100 + v * 133) * 1048576, "ok");
  add("E:\\Archive\\Concerts\\Live in Somewhere (2019).mkv", Math.round(18.4 * 1073741824), "ok");
  add("E:\\Archive\\Concerts\\Encore (2021).mkv", Math.round(9.1 * 1073741824), "pending", { Hash: null, LastHash: null, LastChecked: null });
  // problems
  files[3 * 2].Status = "changed"; files[3 * 2].LastHash = md5(4242); files[3 * 2].LastChecked = iso(2 * H);
  files[3 * 9].Status = "modified"; files[3 * 9].LastHash = md5(777); files[3 * 9].LastChecked = iso(5 * H);
  files[50].Status = "missing"; files[50].LastChecked = iso(2 * H);
  files[61].Status = "unreadable"; files[61].Error = "IOException: The request could not be performed because of an I/O device error."; files[61].LastChecked = iso(3 * H);
  files[70].Status = "never_hashed"; files[70].LastHash = null; files[70].LastChecked = null;
  var problemsSt = ["changed", "modified", "missing", "unreadable"];

  window.__srv = {
    cfg: { HashNewItems: true, ExcludedLibraryIds: [], ExtraFolders: ["E:\\Archive"], Exclude: ["*.nfo", "*.nfo-orig", "*.xml", "*.bif", "*.metathumb", "*.jpg", "*.jpeg", "*.png", "*.webp", "*.tbn", "*.gif", "*.old*", "Thumbs.db", "desktop.ini", ".DS_Store", "*.tmp", "*.part", "*.partial", "*.crdownload", "*.!qB"],
      AutoAcceptModifiedExtensions: [".nfo", ".xml", ".jpg", ".jpeg", ".png", ".webp", ".tbn", ".bif"], ThrottleMBps: 0, PauseDuringPlayback: true, MinDaysBetweenScheduledScans: 150,
      NotifyScanSummary: true, NotifyProblems: true, LegacyDbPath: "D:\\Tools\\filehashes.db" },
    files: files, calls: [], saved: [], queue: 0,
    scan: { State: "hashing", UserPaused: false, PauseReason: null, FileIndex: 6182, FileCount: 14612, BytesTotal: 25.9e12, BytesDone: 11.02e12, BytesPerSecond: 182e6,
      CurrentFile: "D:\\Media\\Movies\\Tears of Steel (2012)\\Tears of Steel (2012) [Bluray-1080p].mkv", CurrentSize: 6.4e9, CurrentDone: 2.9e9, Matched: 6150, Changed: 1, Modified: 1, New: 28, Missing: 1, Unreadable: 1 },
    running: true,
    scans: [
      { Id: 6, Kind: "newmedia", Trigger: "newmedia", Label: "New media Oct 12", Roots: "2026-10-12", State: "completed", Started: iso(30 * H), Ended: iso(26 * H), Total: 7, Done: 7, BytesTotal: 31.2e9, Matched: 0, New: 7, Changed: 0, Modified: 0, Missing: 0, Unreadable: 0, Note: "" },
      { Id: 5, Kind: "item", Trigger: "item", Label: "Sintel (2010)", State: "completed", Started: iso(22 * H), Ended: iso(22 * H - 95000), Total: 4, Done: 4, BytesTotal: 5.2e9, Matched: 3, New: 0, Changed: 1, Modified: 0, Missing: 0, Unreadable: 0, Note: "" },
      { Id: 4, Kind: "full", Trigger: "scheduled", Label: "Full integrity scan", State: "running", Started: iso(19 * H), Ended: null, Total: 14612, Done: 6182, BytesTotal: 25.9e12, Matched: 6150, Changed: 1, Modified: 1, New: 28, Missing: 1, Unreadable: 1, ActiveSeconds: 17.2 * 3600, Note: "resumed after restart" },
      { Id: 3, Kind: "full", State: "completed", Started: iso(183 * D), Ended: iso(180 * D), Total: 14390, Done: 14390, BytesTotal: 25.1e12, Matched: 14211, Changed: 0, Modified: 0, New: 179, Missing: 0, Unreadable: 0, Note: "" },
      { Id: 2, Kind: "full", State: "stopped", Started: iso(186 * D), Ended: null, Total: 14388, Done: 2210, BytesTotal: 25.1e12, Matched: 2210, ActiveSeconds: 11000, Note: "" },
      { Id: 1, Kind: "full", State: "completed", Started: iso(365 * D), Ended: iso(362 * D), Total: 14102, Done: 14102, BytesTotal: 24.4e12, Matched: 14100, Changed: 2, Modified: 0, New: 0, Missing: 0, Unreadable: 0, Note: "offline: F:\\Old" }
    ],
    imp: { Ran: true, Source: "D:\\Tools\\filehashes.db", Time: iso(20 * H), FilesImported: 14316, ChecksImported: 82291, CaseDuplicatesMerged: 16, AlreadyPresent: 0, Ok: 12977, Changed: 0, NeverHashed: 1339, OldestCheck: iso(1140 * D), NewestCheck: iso(100 * D), Seconds: 2.1 }
  };
  var S = window.__srv;
  S.add = add;
  // files on disk the database does not know yet (added to files by "Refresh file list")
  S.disk = [];
  ["Jane Example\\The Long Walk", "Sam Sample\\Quiet Rivers", "Ada Placeholder\\Notes on Nothing"].forEach(function (b, i) {
    var dir = "F:\\Books\\" + b;
    S.disk.push({ path: dir + "\\" + b.split("\\")[1] + ".m4b", size: (310 + i * 47) * 1048576 });
    S.disk.push({ path: dir + "\\cover.jpg", size: 182000 + i * 999 });
    S.disk.push({ path: dir + "\\" + b.split("\\")[1] + ".epub", size: 1.2e6 + i * 5e4 });
    S.disk.push({ path: dir + "\\metadata.opf", size: 3100 + i });
  });
  S.disk.push({ path: "D:\\Media\\Movies\\Sintel (2010)\\extras\\Making of.mp4", size: 640 * 1048576 });
  S.fl = { Running: false, Scheduled: null, Last: { Time: iso(3 * H), Reason: "startup", Roots: 5, RootsOffline: 0, OnDisk: files.length, Added: 0, Removed: 0, Seconds: 4.2 } };
  S.flPolls = 0;
  function flTick() {
    if (!S.fl.Running || ++S.flPolls < 2) return;
    var added = 0;
    S.disk.forEach(function (d) { if (!files.some(function (f) { return f.Path.toLowerCase() === d.path.toLowerCase(); })) { add(d.path, d.size, "pending", { Hash: null, LastHash: null, LastChecked: null, LastResult: null, BaselineDate: null }); added++; } });
    S.fl = { Running: false, Scheduled: null, Last: { Time: new Date().toISOString(), Reason: "refresh button", Roots: 5, RootsOffline: 0, OnDisk: files.length, Added: added, Removed: 0, Seconds: 3.1 } };
  }

  // ---- manual check jobs (simulated: each poll advances the running job) ----
  S.jobs = []; S.jobSeq = 0; S.freeze = false; S.step = 0.34; S.outcome = {};
  function newJob(label, list) {
    var act = S.jobs.filter(function (x) { return x.State === "running" || x.State === "queued"; })[0];
    if (act && list.length) {
      var added = 0;
      list.forEach(function (f) { var pending = act._files.slice(act.Done).indexOf(f) >= 0; if (!pending) { act._files.push(f); act.Total++; act.BytesTotal += f.Status === "missing" ? 0 : f.Size || 0; added++; } });
      act.Batches++; act.LastBatchAdded = added; act.Label = act._first + " + " + (act.Batches - 1) + " more batch" + (act.Batches === 2 ? "" : "es");
      return act;
    }
    var j = { Batches: 1, LastBatchAdded: list.length, _first: label, Id: ++S.jobSeq, Label: label, Source: "manual", State: "queued", Created: new Date().toISOString(), Total: list.length, Done: 0, BytesTotal: list.reduce(function (a, f) { return a + (f.Status === "missing" ? 0 : f.Size || 0); }, 0), BytesDone: 0,
      CurrentFile: null, CurrentSize: 0, CurrentDone: 0, Ok: 0, New: 0, Changed: 0, Modified: 0, Missing: 0, Unreadable: 0, Absent: 0, Findings: [], Results: [], BytesPerSecond: 0, _files: list };
    if (!list.length) { j.State = "done"; j.Ended = j.Created; }
    S.jobs.push(j); return j;
  }
  function advance() {
    if (S.freeze) return;
    var j = S.jobs.filter(function (x) { return x.State === "running"; })[0] || S.jobs.filter(function (x) { return x.State === "queued"; })[0];
    if (!j) return;
    if (j.State === "queued") { j.State = "running"; j.Started = new Date().toISOString(); }
    var f = j._files[j.Done];
    if (!j.CurrentFile) { j.CurrentFile = f.Path; j.CurrentSize = f.Status === "missing" ? 0 : f.Size; j.CurrentDone = 0; }
    var inc = Math.max(1, Math.ceil(j.CurrentSize * S.step));
    j.CurrentDone = Math.min(j.CurrentSize, j.CurrentDone + inc); j.BytesDone += inc; j.BytesPerSecond = 187.4e6;
    if (j.CurrentDone >= j.CurrentSize) {
      var res = S.outcome[f.Path] || (f.Status === "missing" ? "missing" : f.Status === "changed" ? "changed" : f.Status === "unreadable" ? "unreadable" : (f.Status === "pending" || f.Status === "never_hashed") ? "new" : "match");
      f.LastChecked = new Date().toISOString(); f.LastResult = res;
      if (res === "match" || res === "new") { f.Status = "ok"; f.Hash = f.Hash || md5(f.Id + 31); f.LastHash = f.Hash; }
      else if (res === "changed") { f.Status = "changed"; f.LastHash = md5(f.Id + 4242); }
      else f.Status = res;
      var key = { match: "Ok", "new": "New", changed: "Changed", modified: "Modified", missing: "Missing", unreadable: "Unreadable" }[res]; j[key]++;
      j.Results.push({ FileId: f.Id, Path: f.Path, Result: res });
      if (res !== "match" && res !== "new") j.Findings.push({ FileId: f.Id, Path: f.Path, Result: res });
      j.Done++; j.CurrentFile = null;
      if (j.Done >= j.Total) { j.State = "done"; j.Ended = new Date().toISOString(); }
    }
  }
  function pub(j) { var c = JSON.parse(JSON.stringify(j)); delete c._files; delete c._first; return c; }
  function manualStatus() {
    var cur = S.jobs.filter(function (x) { return x.State === "running"; })[0] || null, queued = S.jobs.filter(function (x) { return x.State === "queued"; });
    var fin = S.jobs.filter(function (x) { return x.State === "done" || x.State === "cancelled"; }).slice(-1)[0] || null;
    return { Active: !!cur || queued.length > 0, Job: cur && pub(cur), QueuedJobs: queued.length, PendingFiles: 0, BytesPerSecond: cur ? 187.4e6 : 0, SecondsLeft: cur ? (cur.BytesTotal - cur.BytesDone) / 187.4e6 : null, LastFinished: fin && pub(fin) };
  }
  S.newJob = newJob; S.advance = advance;
  function parse(u) { var p = u.split("?"), q = {}; (p[1] || "").split("&").forEach(function (kv) { if (!kv) return; var a = kv.split("="); q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ""); }); return { path: p[0], q: q }; }
  function counts() { var c = {}; files.forEach(function (f) { if (f.Ignored) { c.ignored = (c.ignored || 0) + 1; return; } c[f.Status] = (c[f.Status] || 0) + 1; }); return c; }
  function under(f, paths) { return paths.some(function (p) { return (f.Folder + "\\").toLowerCase().indexOf((p + "\\").toLowerCase()) === 0; }); }
  function groups(by) {
    if (by === "folder") {
      var tops = {}; files.forEach(function (f) { var t = f.Path.split("\\").slice(0, 2).join("\\"); tops[t] = 1; });
      return Object.keys(tops).sort().map(function (t) { return { Key: t, Label: t, Paths: [t] }; });
    }
    var g = libs.map(function (l) { return { Key: "lib:" + l.Id, Label: l.Name + (S.cfg.ExcludedLibraryIds.indexOf(l.Id) >= 0 ? " (not scanned)" : ""), Paths: l.Locations }; });
    if (S.cfg.ExtraFolders.length) g.push({ Key: "extra", Label: "Extra folders", Paths: S.cfg.ExtraFolders });
    return g;
  }
  function typeOk(f, t) { return !t || (t === "(none)" ? !f.Ext : f.Ext === t); }
  function api(method, u) {
    var r = parse(u), q = r.q, path = r.path.replace(/^ClawMediaIntegrity\//, "");
    S.calls.push(method + " " + path);
    var m;
    if (method === "GET" && (m = /^Check\/Jobs\/(\d+)$/.exec(path))) { advance(); var jj = S.jobs.filter(function (x) { return x.Id === +m[1]; })[0]; if (!jj) return { Id: +m[1], State: "unknown" }; var pj = pub(jj), since = Math.min(+q.Since || 0, pj.Results.length); pj.ResultsOffset = since; pj.Results = pj.Results.slice(since); return pj; }
    if (method === "GET" && (m = /^Scans\/(\d+)$/.exec(path))) {
      var sid = +m[1], sc = S.scans.filter(function (x) { return x.Id === sid; })[0], jb = S.jobs.filter(function (x) { return 1000 + x.Id === sid; })[0];
      var finds = jb ? (jb.Findings || []).map(function (fd) { return files.filter(function (x) { return x.Id === fd.FileId; })[0]; }).filter(Boolean)
        : files.filter(function (f) { return problemsSt.indexOf(f.Status) >= 0; }).slice(0, sid === 5 ? 1 : 4);
      return { Scan: sc || { Id: sid, Kind: "manual", Label: jb && jb.Label }, Findings: finds, Checks: sc ? sc.Done : jb ? jb.Done : 0 };
    }
    if (method === "GET" && (m = /^Files\/(\d+)\/History$/.exec(path))) {
      var f = files.filter(function (x) { return x.Id === +m[1]; })[0];
      var checks = [
        { Time: iso(2 * H), Result: f.Status === "ok" ? "match" : f.Status, Md5: f.LastHash, Size: f.Size, Seconds: 41.3, Source: "scan" },
        { Time: iso(183 * D), Result: "match", Md5: f.Hash, Size: f.Size, Seconds: 39.8, Source: "scan" },
        { Time: iso(365 * D), Result: "legacy-match", Md5: f.Hash, Size: f.Size, Seconds: 12, Source: "legacy" },
        { Time: iso(400 * D), Result: "baseline", Md5: f.Hash, Size: f.Size, Seconds: 44, Source: "legacy" }];
      if (f.Status === "missing") checks[0].Md5 = null;
      return { File: f, Checks: f.Status === "never_hashed" ? [] : checks };
    }
    switch (method + " " + path) {
      case "POST Check/Files": { var fl = q.Ids.split(",").map(Number).map(function (i) { return files.filter(function (x) { return x.Id === i; })[0]; }).filter(Boolean); return pub(newJob(fl.length === 1 ? fl[0].Name : fl.length + " selected files", fl)); }
      case "POST Check/Items": return pub(newJob("Sintel (2010)", files.filter(function (f) { return /Sintel/.test(f.Path); })));
      case "POST Check/Matching": {
        var ml;
        if (q.Group === "problems") ml = files.filter(function (f) { return problemsSt.indexOf(f.Status) >= 0 && (q.IncludeIgnored === "true" || !f.Ignored) && (!q.Status || f.Status === q.Status) && (!q.Search || f.Path.toLowerCase().indexOf(q.Search.toLowerCase()) >= 0); });
        else {
          var mg = groups(q.GroupBy).filter(function (x) { return x.Key === q.Group; })[0];
          ml = files.filter(function (f) { return q.Group === "all" || (mg && under(f, mg.Paths)); });
          if (q.Search) ml = ml.filter(function (f) { return f.Path.toLowerCase().indexOf(q.Search.toLowerCase()) >= 0; });
          if (q.Status) ml = ml.filter(function (f) { return q.Status === "problems" ? problemsSt.indexOf(f.Status) >= 0 && !f.Ignored : q.Status === "pending" ? /pending|never/.test(f.Status) : q.Status === "ignored" ? f.Ignored : f.Status === q.Status; });
        }
        if (q.Type) ml = ml.filter(function (f) { return typeOk(f, q.Type); });
        S.lastMatching = { q: q, n: ml.length };
        return pub(newJob(q.Group === "problems" ? "All matching problems" : "All matching files", ml));
      }
      case "POST FileList/Refresh": S.fl.Running = true; S.flPolls = 0; return { Ok: true };
      case "POST Check/Group": {
        if (q.Group === "pending") return pub(newJob("All files not yet hashed", files.filter(function (f) { return (f.Status === "pending" || f.Status === "never_hashed") && !f.Ignored; }))); var gg = groups(q.GroupBy).filter(function (x) { return x.Key === q.Group; })[0]; return pub(newJob(gg ? gg.Label : "?", gg ? files.filter(function (f) { return under(f, gg.Paths); }) : [])); }
      case "POST Check/Cancel": S.jobs.forEach(function (j) { if (j.State === "queued" || j.State === "running") { j.State = "cancelled"; j.Ended = new Date().toISOString(); j.CurrentFile = null; } }); return { Ok: true };
      case "GET Check/Jobs": return S.jobs.slice().reverse().map(pub);
      case "GET Status": {
        var c = counts(), sc = S.scan;
        var st = S.running ? (sc.UserPaused ? "paused" : sc.State) : "idle";
        return { State: st, PauseReason: S.running ? (sc.UserPaused ? "paused" : sc.PauseReason) : null, UserPaused: sc.UserPaused, ScanId: 4, FileIndex: sc.FileIndex, FileCount: sc.FileCount, CurrentFile: sc.CurrentFile,
          CurrentSize: sc.CurrentSize, CurrentDone: sc.CurrentDone, BytesDone: sc.BytesDone, BytesTotal: sc.BytesTotal, BytesPerSecond: sc.BytesPerSecond,
          SecondsLeft: (sc.BytesTotal - sc.BytesDone) / sc.BytesPerSecond, Percent: 100 * sc.BytesDone / sc.BytesTotal, Matched: sc.Matched, Changed: sc.Changed, Modified: sc.Modified, New: sc.New, Missing: sc.Missing, Unreadable: sc.Unreadable,
          Started: iso(19 * H), Resumable: S.running ? null : S.resumable || null, LastScan: S.scans[0], QueueLength: S.queue, QueueCurrent: null, PlaybackActive: false, Counts: c,
          Enabled: S.cfg.Enabled !== false, Files: files.length, Problems: problemsSt.reduce(function (a, k) { return a + (c[k] || 0); }, 0), Import: S.imp, LastSkipReason: null, LastCompleteVerification: iso(180 * D), RootCount: 4, Now: new Date().toISOString(), FileList: (flTick(), S.fl), Manual: (advance(), manualStatus()) };
      }
      case "POST Scan/Start": S.running = true; S.resumable = null; return { Ok: true };
      case "POST Scan/StartFresh": S.running = true; S.resumable = null; S.scan.FileIndex = 0; S.scan.BytesDone = 0; return { Ok: true };
      case "POST Scan/Pause": S.scan.UserPaused = true; return { Ok: true };
      case "POST Scan/Resume": S.scan.UserPaused = false; return { Ok: true };
      case "POST Scan/Stop": S.running = false; S.scan.UserPaused = false; S.resumable = { Id: 4, State: "stopped", Started: iso(19 * H), Done: S.scan.FileIndex, Total: S.scan.FileCount }; return { Ok: true };
      case "GET Skip/Recommended": return ["*.nfo", "*.nfo-orig", "*.xml", "*.bif", "*.metathumb", "*.jpg", "*.jpeg", "*.png", "*.webp", "*.tbn", "*.gif", "*.old*", "Thumbs.db", "desktop.ini", ".DS_Store", "*.tmp", "*.part", "*.partial", "*.crdownload", "*.!qB"];
      case "POST Skip/Preview": S.previews = (S.previews || []).concat([q.Patterns]); return { WouldRemove: S.skipWould || 0, TrackedNow: files.length };
      case "GET Problems": return files.filter(function (f) { return problemsSt.indexOf(f.Status) >= 0 && (q.IncludeIgnored === "true" || !f.Ignored); });
      case "POST Files/Action": {
        var ids = q.Ids.split(",").map(Number), done = 0, skipped = 0;
        ids.forEach(function (i) {
          var f = files.filter(function (x) { return x.Id === i; })[0]; if (!f) { skipped++; return; }
          if (q.Action === "accept") { if (f.Status === "changed" || f.Status === "modified") { f.Hash = f.LastHash; f.Status = "ok"; done++; } else skipped++; }
          else if (q.Action === "recheck") { S.queue++; done++; }
          else if (q.Action === "ignore") { f.Ignored = true; done++; }
          else if (q.Action === "unignore") { f.Ignored = false; done++; }
          else if (q.Action === "forget") { if (f.Status === "missing") { files.splice(files.indexOf(f), 1); done++; } else skipped++; }
        });
        return { Done: done, Skipped: skipped };
      }
      case "GET Groups": {
        var gs = groups(q.GroupBy), all = [];
        gs.forEach(function (g) { all = all.concat(g.Paths); });
        var out = gs.map(function (g) {
          var fs = files.filter(function (f) { return under(f, g.Paths); });
          var chk = fs.map(function (f) { return f.LastChecked; }).filter(Boolean).sort();
          return { Key: g.Key, Label: g.Label, Paths: g.Paths, Files: fs.length, Bytes: fs.reduce(function (a, f) { return a + (f.Size || 0); }, 0), Ok: fs.filter(function (f) { return f.Status === "ok"; }).length,
            Problems: fs.filter(function (f) { return problemsSt.indexOf(f.Status) >= 0 && !f.Ignored; }).length, Pending: fs.filter(function (f) { return f.Status === "pending" || f.Status === "never_hashed"; }).length,
            OldestCheck: chk[0] || null, NewestCheck: chk[chk.length - 1] || null };
        });
        return out;
      }
      case "GET Info": return { Enabled: S.cfg.Enabled !== false, Version: "1.0.6.0" };
      case "GET Files/Types": {
        var tg = groups(q.GroupBy).filter(function (x) { return x.Key === q.Group; })[0];
        var tl = q.Group === "all" ? files.slice() : files.filter(function (f) { return tg && under(f, tg.Paths); });
        if (q.Search) tl = tl.filter(function (f) { return f.Path.toLowerCase().indexOf(q.Search.toLowerCase()) >= 0; });
        if (q.Status) tl = tl.filter(function (f) { return q.Status === "problems" ? problemsSt.indexOf(f.Status) >= 0 && !f.Ignored : q.Status === "pending" ? /pending|never/.test(f.Status) : q.Status === "ignored" ? f.Ignored : f.Status === q.Status; });
        var tc = {}; tl.forEach(function (f) { tc[f.Ext] = (tc[f.Ext] || 0) + 1; });
        return Object.keys(tc).sort().map(function (k) { return { Type: k, Count: tc[k] }; });
      }
      case "GET Files": {
        var g = groups(q.GroupBy).filter(function (x) { return x.Key === q.Group; })[0];
        var list = q.Group === "all" ? files.slice() : files.filter(function (f) { return g && under(f, g.Paths); });
        if (q.Search) list = list.filter(function (f) { return f.Path.toLowerCase().indexOf(q.Search.toLowerCase()) >= 0; });
        if (q.Status) list = list.filter(function (f) { return q.Status === "problems" ? problemsSt.indexOf(f.Status) >= 0 && !f.Ignored : q.Status === "pending" ? /pending|never/.test(f.Status) : q.Status === "ignored" ? f.Ignored : f.Status === q.Status; });
        if (q.Type) list = list.filter(function (f) { return typeOk(f, q.Type); });
        var key = { type: "Ext", name: "Name", size: "Size", hash: "Hash", checked: "LastChecked", status: "Status" }[q.Sort || "name"], d = q.Desc === "true" ? -1 : 1;
        list.sort(function (a, b) { var x = a[key], y = b[key]; if (typeof x === "string") { x = x.toLowerCase(); y = (y || "").toLowerCase(); } return (x < y ? -1 : x > y ? 1 : 0) * d; });
        var st = +q.StartIndex || 0, lim = +q.Limit || 100;
        return { Total: list.length, StartIndex: st, Items: list.slice(st, st + lim) };
      }
      case "GET Scans": {
        // finished manual jobs appear as Activity entries (one per job, combined batches included)
        var fromJobs = S.jobs.filter(function (j) { return (j.State === "done" || j.State === "cancelled") && j.Total > 0; }).map(function (j) {
          return { Id: 1000 + j.Id, Kind: j.Source === "item" ? "item" : "manual", Trigger: j.Source, Label: j.Label, State: j.State === "done" ? "completed" : "stopped", Started: j.Started || j.Created, Ended: j.Ended, Total: j.Total, Done: j.Done, BytesTotal: j.BytesTotal,
            Matched: j.Ok, New: j.New, Changed: j.Changed, Modified: j.Modified, Missing: j.Missing, Unreadable: j.Unreadable, Note: j.Batches > 1 ? j.Batches + " batches combined" : "", _job: j };
        });
        return fromJobs.reverse().concat(S.scans).map(function (x) { var c = Object.assign({}, x); delete c._job; return c; });
      }
      case "GET Libraries": return libs.map(function (l) { return Object.assign({}, l, { Included: S.cfg.ExcludedLibraryIds.indexOf(l.Id) < 0 }); });
      case "POST Import": return Object.assign({}, S.imp, { FilesImported: 0, AlreadyPresent: 14316, ChecksImported: 0, Time: new Date().toISOString() });
    }
    throw new Error("unmocked " + method + " " + u);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  window.ApiClient = {
    getUrl: function (p, q) { var s = Object.keys(q || {}).filter(function (k) { return q[k] !== undefined && q[k] !== null; }).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&"); return p + (s ? "?" + s : ""); },
    getJSON: function (u) { try { return Promise.resolve(clone(api("GET", u))); } catch (e) { return Promise.reject(e); } },
    ajax: function (o) { try { return Promise.resolve(clone(api(o.type, o.url))); } catch (e) { return Promise.reject(e); } },
    getPluginConfiguration: function () { return Promise.resolve(clone(S.cfg)); }, getInstalledPlugins: function () { return Promise.resolve([{ Id: "5b0c7f3e-2d4a-4e61-9a8b-6c1f0e7d3a52", Name: "Media Integrity", Version: "1.0.6.0" }]); },
    updatePluginConfiguration: function (pid, c) { S.cfg = clone(c); S.saved.push(clone(c)); return Promise.resolve({}); }
  };
  window.Dashboard = { showLoadingMsg: function () {}, hideLoadingMsg: function () {}, processPluginConfigurationUpdateResult: function () { window.__savedToast = true; } };
  window.require = function (deps, fn) { if (deps[0] === "toast") fn(function (m) { (window.__toasts = window.__toasts || []).push(m); }); };
  window.confirm = function () { return true; };
  window.define = function (deps, fn) { window.__View = fn(); };
  window.__boot = function () { var v = document.getElementById("clawMediaIntegrityPage"); new window.__View(v); v.dispatchEvent(new CustomEvent("viewshow")); };
})();
