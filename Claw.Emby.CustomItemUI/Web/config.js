define([], function () {
  function syncColorPicker(view) {
    var v = view.querySelector("#txtButtonTextColor").value.trim();
    var p = view.querySelector("#pickButtonTextColor");
    if (/^#[0-9a-f]{6}$/i.test(v)) p.value = v;
    else if (/^#[0-9a-f]{3}$/i.test(v)) p.value = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    else if (/^white$/i.test(v) || v === "") p.value = "#ffffff";
  }

  function wireColorPicker(view) {
    var p = view.querySelector("#pickButtonTextColor");
    var t = view.querySelector("#txtButtonTextColor");
    if (!p || p.getAttribute("data-wired")) return;
    p.setAttribute("data-wired", "1");
    p.addEventListener("input", function () { t.value = p.value; });
    t.addEventListener("change", function () { syncColorPicker(view); });
  }
  "use strict";

  var pluginId = "b7e4c2a1-9f3d-4e8b-a6c5-1d2e3f4a5b6c";

  // =================== Dashboard layout editor (row builder + table) ===================
  var DASH_SECTIONS = [
    { id: "maintenance", label: "Maintenance banner", note: "only in maintenance mode", cond: true },
    { id: "serverinfo", label: "Server info", note: "" },
    { id: "alerts", label: "Alerts", note: "hidden while there are no alerts", cond: true },
    { id: "nowplaying", label: "Now playing", note: "hidden while nothing plays", cond: true },
    { id: "runningtasks", label: "Running tasks", note: "only while a task runs", cond: true },
    { id: "recordings", label: "Active recordings", note: "only while recording", cond: true },
    { id: "activity", label: "Activity", note: "" }
  ];
  var DASH_PRESET = [
    { Id: "maintenance", Row: 1, Order: 1, Span: 12, Visible: true },
    { Id: "serverinfo", Row: 2, Order: 1, Span: 6, Visible: true },
    { Id: "alerts", Row: 2, Order: 2, Span: 6, Visible: true },
    { Id: "nowplaying", Row: 3, Order: 1, Span: 8, Visible: true },
    { Id: "runningtasks", Row: 3, Order: 2, Span: 4, Visible: true },
    { Id: "recordings", Row: 4, Order: 1, Span: 12, Visible: true },
    { Id: "activity", Row: 5, Order: 1, Span: 12, Visible: true }
  ];

  function dashInt(v, def, min, max) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = def;
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    return n;
  }
  function sectionInfo(id) {
    return DASH_SECTIONS.filter(function (s) { return s.id === id; })[0] || { id: id, label: id, note: "" };
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Same algorithm as the injected script: known ids only, missing ones appended as rows, renumbered.
  function dashNormalize(list) {
    var src = (list && list.length) ? list : DASH_PRESET;
    var known = {}, seen = {}, out = [];
    DASH_SECTIONS.forEach(function (s) { known[s.id] = true; });
    src.forEach(function (x, i) {
      if (!x) return;
      var id = String(x.Id || x.id || "").toLowerCase();
      if (!known[id] || seen[id]) return;
      seen[id] = true;
      out.push({
        Id: id,
        Row: dashInt(x.Row, 1, 1, 999),
        Order: dashInt(x.Order, i + 1, 0, 999),
        Span: dashInt(x.Span, 12, 1, 12),
        Visible: x.Visible !== false,
        _i: i
      });
    });
    var maxRow = out.reduce(function (m, x) { return Math.max(m, x.Row); }, 0);
    DASH_SECTIONS.forEach(function (s) {
      if (seen[s.id]) return;
      var p = DASH_PRESET.filter(function (x) { return x.Id === s.id; })[0];
      out.push({ Id: s.id, Row: ++maxRow, Order: 1, Span: p ? p.Span : 12, Visible: true, _i: 999 });
    });
    out.sort(function (a, b) { return a.Row - b.Row || a.Order - b.Order || a._i - b._i; });
    var row = 0, lastRow = null, ord = 0;
    out.forEach(function (x) {
      if (x.Row !== lastRow) { row++; lastRow = x.Row; ord = 0; }
      x.Row = row; x.Order = ++ord; delete x._i;
    });
    return out;
  }
  function toRows(list) {
    var rows = [];
    list.forEach(function (x) { (rows[x.Row - 1] = rows[x.Row - 1] || []).push(x); });
    return rows.filter(function (r) { return r && r.length; });
  }
  function fromRows(rows) {
    var out = [];
    rows.filter(function (r) { return r.length; }).forEach(function (r, ri) {
      r.forEach(function (x, oi) { out.push({ Id: x.Id, Row: ri + 1, Order: oi + 1, Span: x.Span, Visible: x.Visible }); });
    });
    return out;
  }
  function rowSum(r) { return r.reduce(function (a, x) { return a + x.Span; }, 0); }
  function overRows(list) {
    return toRows(list).map(function (r, i) { return { row: i + 1, sum: rowSum(r) }; }).filter(function (x) { return x.sum > 12; });
  }

  // Move a section. target = { row: index (0-based), index: position } or { newRow: index (0-based insert position) }
  function moveSection(list, id, target) {
    var rows = toRows(list).map(function (r) { return r.slice(); });
    var item = null, fromRow = -1, fromIdx = -1;
    rows.forEach(function (r, ri) { r.forEach(function (x, xi) { if (x.Id === id) { item = x; fromRow = ri; fromIdx = xi; } }); });
    if (!item) return list;
    if (target.newRow != null) {
      if (rows[fromRow].length === 1 && (target.newRow === fromRow || target.newRow === fromRow + 1)) return list; // already alone there
      rows[fromRow].splice(fromIdx, 1);
      var at = target.newRow;
      rows.splice(at, 0, [item]);
    } else {
      var to = target.row, idx = target.index;
      if (to === fromRow && idx > fromIdx) idx--;
      rows[fromRow].splice(fromIdx, 1);
      rows[to].splice(Math.max(0, Math.min(idx, rows[to].length)), 0, item);
    }
    return dashNormalize(fromRows(rows));
  }
  function nudge(list, id, dir) {
    var rows = toRows(list), ri = -1, xi = -1;
    rows.forEach(function (r, i) { r.forEach(function (x, j) { if (x.Id === id) { ri = i; xi = j; } }); });
    if (ri < 0) return list;
    if (dir === "left") return xi > 0 ? moveSection(list, id, { row: ri, index: xi - 1 }) : list;
    if (dir === "right") return xi < rows[ri].length - 1 ? moveSection(list, id, { row: ri, index: xi + 2 }) : list;
    if (dir === "up") {
      if (ri === 0) return rows[ri].length > 1 ? moveSection(list, id, { newRow: 0 }) : list;
      return moveSection(list, id, { row: ri - 1, index: rows[ri - 1].length });
    }
    if (dir === "down") {
      if (ri === rows.length - 1) return rows[ri].length > 1 ? moveSection(list, id, { newRow: rows.length }) : list;
      return moveSection(list, id, { row: ri + 1, index: rows[ri + 1].length });
    }
    return list;
  }

  function dashState(view) {
    if (!view._clawDash) view._clawDash = { list: dashNormalize(null), tab: "builder" };
    return view._clawDash;
  }

  function renderDash(view) {
    var st = dashState(view);
    var rows = toRows(st.list);
    var h = "";
    rows.forEach(function (r, ri) {
      var sum = rowSum(r);
      h += '<div class="cdl-newrow" data-newrow="' + ri + '"></div>';
      h += '<div class="cdl-row' + (sum > 12 ? " cdl-over" : "") + '" data-row="' + ri + '">';
      h += '<div class="cdl-rownum">Row ' + (ri + 1) + "<small>" + sum + "/12</small></div>";
      h += '<div class="cdl-tiles">';
      r.forEach(function (x) {
        var info = sectionInfo(x.Id), opts = "";
        for (var w = 1; w <= 12; w++) opts += '<option value="' + w + '"' + (w === x.Span ? " selected" : "") + ">" + w + "/12</option>";
        h += '<div class="cdl-tile' + (info.cond ? " cdl-cond" : "") + (x.Visible ? "" : " cdl-hiddentile") + '" data-id="' + esc(x.Id) + '" style="grid-column:span ' + x.Span + '">' +
          '<div class="cdl-head"><span class="cdl-grip" title="Drag to move" aria-label="Drag ' + esc(info.label) + '">&#8942;&#8942;</span>' +
          '<span class="cdl-name" title="' + esc(info.label) + '">' + esc(info.label) + "</span>" +
          '<button type="button" class="cdl-mini cdl-vis" title="Show or hide this section">' + (x.Visible ? "Shown" : "Hidden") + "</button></div>" +
          '<div class="cdl-body"><label>Width <select class="cdl-span" aria-label="Width of ' + esc(info.label) + '">' + opts + "</select></label>" +
          '<span class="cdl-mv">' +
          '<button type="button" class="cdl-mini" data-mv="left" title="Move left">&#9664;</button>' +
          '<button type="button" class="cdl-mini" data-mv="right" title="Move right">&#9654;</button>' +
          '<button type="button" class="cdl-mini" data-mv="up" title="Move to the row above">&#9650;</button>' +
          '<button type="button" class="cdl-mini" data-mv="down" title="Move to the row below">&#9660;</button>' +
          "</span></div>" +
          (info.note ? '<div class="cdl-note">' + esc(info.note) + "</div>" : "") +
          "</div>";
      });
      if (sum < 12) h += '<div class="cdl-free" style="grid-column:span ' + (12 - sum) + '">' + (12 - sum) + "/12 free</div>";
      h += "</div></div>";
    });
    h += '<div class="cdl-newrow cdl-newrow-end" data-newrow="' + rows.length + '"></div>';
    view.querySelector(".cdl-rows").innerHTML = h;

    // Table: fixed section order so rows don't jump while typing.
    var byId = {};
    st.list.forEach(function (x) { byId[x.Id] = x; });
    var over = {};
    overRows(st.list).forEach(function (o) { over[o.row] = true; });
    view.querySelector(".cdl-tbody").innerHTML = DASH_SECTIONS.map(function (s) {
      var x = byId[s.id];
      return '<tr data-id="' + s.id + '"' + (over[x.Row] ? ' class="cdl-over"' : "") + "><td>" + esc(s.label) +
        (s.note ? '<div class="cdl-note">' + esc(s.note) + "</div>" : "") + "</td>" +
        '<td><input type="checkbox" class="cdl-t-vis"' + (x.Visible ? " checked" : "") + " /></td>" +
        '<td><input type="number" class="cdl-t-row" min="1" max="99" value="' + x.Row + '" /></td>' +
        '<td><input type="number" class="cdl-t-order" min="1" max="99" value="' + x.Order + '" /></td>' +
        '<td><input type="number" class="cdl-t-span" min="1" max="12" value="' + x.Span + '" /></td></tr>';
    }).join("");

    var err = view.querySelector(".cdl-error");
    var o = overRows(st.list);
    err.classList.toggle("cdl-show", o.length > 0);
    err.textContent = o.length ? "Too wide: " + o.map(function (x) { return "row " + x.row + " adds up to " + x.sum + "/12"; }).join(", ") + ". Make the widths add up to 12 or less, or move a section to another row, before saving." : "";
    view.querySelectorAll(".cdl-tab").forEach(function (t) { t.classList.toggle("cdl-on", t.getAttribute("data-tab") === st.tab); });
    view.querySelectorAll(".cdl-pane").forEach(function (p) { p.style.display = p.getAttribute("data-pane") === st.tab ? "" : "none"; });
  }

  function setList(view, list) {
    dashState(view).list = dashNormalize(list);
    renderDash(view);
  }

  function readTable(view) {
    var out = [];
    view.querySelectorAll(".cdl-tbody tr").forEach(function (tr) {
      out.push({
        Id: tr.getAttribute("data-id"),
        Visible: tr.querySelector(".cdl-t-vis").checked,
        Row: dashInt(tr.querySelector(".cdl-t-row").value, 1, 1, 99),
        Order: dashInt(tr.querySelector(".cdl-t-order").value, 1, 1, 99),
        Span: dashInt(tr.querySelector(".cdl-t-span").value, 12, 1, 12)
      });
    });
    return out;
  }

  // Pointer-events drag & drop (mouse, pen and touch share one code path).
  function wireDrag(view) {
    var host = view.querySelector(".cdl-rows");
    var drag = null;

    function clearMarks() {
      host.querySelectorAll(".cdl-target,.cdl-before,.cdl-end").forEach(function (e) { e.classList.remove("cdl-target", "cdl-before", "cdl-end"); });
    }
    function computeTarget(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el || !host.contains(el)) return null;
      var nr = el.closest(".cdl-newrow");
      if (nr) return { newRow: parseInt(nr.getAttribute("data-newrow"), 10), el: nr };
      var row = el.closest(".cdl-row");
      if (!row) return null;
      var ri = parseInt(row.getAttribute("data-row"), 10);
      var tiles = Array.prototype.slice.call(row.querySelectorAll(".cdl-tile"));
      var idx = tiles.length, before = null;
      for (var i = 0; i < tiles.length; i++) {
        var r = tiles[i].getBoundingClientRect();
        var sameLine = y >= r.top && y <= r.bottom;
        if ((sameLine && x < r.left + r.width / 2) || y < r.top) { idx = i; before = tiles[i]; break; }
      }
      return { row: ri, index: idx, el: row, before: before };
    }
    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.active) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        drag.active = true;
        var r = drag.tile.getBoundingClientRect();
        drag.ghost = drag.tile.cloneNode(true);
        drag.ghost.classList.add("cdl-ghost");
        drag.ghost.style.width = r.width + "px";
        drag.offX = drag.x0 - r.left; drag.offY = drag.y0 - r.top;
        view.querySelector(".cdl-wrap").appendChild(drag.ghost);
        drag.tile.classList.add("cdl-dragging");
        host.classList.add("cdl-isdragging");
      }
      e.preventDefault();
      drag.ghost.style.left = (e.clientX - drag.offX) + "px";
      drag.ghost.style.top = (e.clientY - drag.offY) + "px";
      clearMarks();
      var t = computeTarget(e.clientX, e.clientY);
      drag.target = t;
      if (t) {
        t.el.classList.add("cdl-target");
        if (t.before) t.before.classList.add("cdl-before");
        else if (t.row != null) t.el.querySelector(".cdl-tiles").classList.add("cdl-end");
      }
    }
    function end(e, cancelled) {
      if (!drag) return;
      var d = drag;
      drag = null;
      try { d.grip.releasePointerCapture(d.pid); } catch (x) { /* already released */ }
      if (d.ghost) d.ghost.remove();
      host.classList.remove("cdl-isdragging");
      clearMarks();
      if (d.active && !cancelled && d.target) {
        var st = dashState(view);
        st.list = moveSection(st.list, d.id, d.target.newRow != null ? { newRow: d.target.newRow } : { row: d.target.row, index: d.target.index });
      }
      renderDash(view);
    }
    host.addEventListener("pointerdown", function (e) {
      var grip = e.target.closest(".cdl-grip");
      if (!grip || (e.button != null && e.button !== 0)) return;
      var tile = grip.closest(".cdl-tile");
      e.preventDefault();
      drag = { id: tile.getAttribute("data-id"), tile: tile, grip: grip, pid: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, target: null };
      try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", function (e) { end(e, false); });
    host.addEventListener("pointercancel", function (e) { end(e, true); });
    host.addEventListener("lostpointercapture", function (e) { if (drag && drag.active) end(e, false); });
  }

  function wireDash(view) {
    if (view.getAttribute("data-cdl-wired")) return;
    view.setAttribute("data-cdl-wired", "1");
    wireDrag(view);
    var rowsHost = view.querySelector(".cdl-rows");
    rowsHost.addEventListener("click", function (e) {
      var tile = e.target.closest(".cdl-tile");
      if (!tile) return;
      var id = tile.getAttribute("data-id"), st = dashState(view);
      var mv = e.target.closest("[data-mv]");
      if (mv) { st.list = nudge(st.list, id, mv.getAttribute("data-mv")); renderDash(view); return; }
      if (e.target.closest(".cdl-vis")) {
        st.list.forEach(function (x) { if (x.Id === id) x.Visible = !x.Visible; });
        renderDash(view);
      }
    });
    rowsHost.addEventListener("change", function (e) {
      if (!e.target.classList.contains("cdl-span")) return;
      var id = e.target.closest(".cdl-tile").getAttribute("data-id"), st = dashState(view);
      st.list.forEach(function (x) { if (x.Id === id) x.Span = dashInt(e.target.value, 12, 1, 12); });
      renderDash(view);
    });
    view.querySelector(".cdl-tbody").addEventListener("change", function () { setList(view, readTable(view)); });
    view.querySelectorAll(".cdl-tab").forEach(function (t) {
      t.addEventListener("click", function () { dashState(view).tab = t.getAttribute("data-tab"); renderDash(view); });
    });
    view.querySelector(".cdl-reset").addEventListener("click", function () { setList(view, null); });
  }

  function loadDash(view, config) {
    view.querySelector("#chkEnableDashboardLayout").checked = config.EnableDashboardLayout !== false;
    view.querySelector("#chkDashboardFillRows").checked = config.DashboardFillRows !== false;
    view.querySelector("#txtDashboardStackBelowPx").value = dashInt(config.DashboardStackBelowPx, 960, 320, 4000);
    view.querySelector("#txtDashboardAlertsLimit").value = dashInt(config.DashboardAlertsLimit, 4, 1, 100);
    view.querySelector("#txtDashboardActivityLimit").value = dashInt(config.DashboardActivityLimit, 10, 1, 100);
    view.querySelector("#selectDashboardNowPlayingPerRow").value = String(dashInt(config.DashboardNowPlayingPerRow, 0, 0, 6));
    view.querySelector("#chkDashboardActivityTable").checked = config.DashboardActivityTable !== false;
    view.querySelector("#chkDashboardAlertsTable").checked = config.DashboardAlertsTable !== false;
    setList(view, config.DashboardSections);
  }

  function readDash(view, out) {
    out.EnableDashboardLayout = view.querySelector("#chkEnableDashboardLayout").checked;
    out.DashboardFillRows = view.querySelector("#chkDashboardFillRows").checked;
    out.DashboardStackBelowPx = dashInt(view.querySelector("#txtDashboardStackBelowPx").value, 960, 320, 4000);
    out.DashboardAlertsLimit = dashInt(view.querySelector("#txtDashboardAlertsLimit").value, 4, 1, 100);
    out.DashboardActivityLimit = dashInt(view.querySelector("#txtDashboardActivityLimit").value, 10, 1, 100);
    out.DashboardNowPlayingPerRow = dashInt(view.querySelector("#selectDashboardNowPlayingPerRow").value, 0, 0, 6);
    out.DashboardActivityTable = view.querySelector("#chkDashboardActivityTable").checked;
    out.DashboardAlertsTable = view.querySelector("#chkDashboardAlertsTable").checked;
    out.DashboardSections = dashState(view).list.map(function (x) {
      return { Id: x.Id, Row: x.Row, Order: x.Order, Span: x.Span, Visible: x.Visible };
    });
    return out;
  }


  function loadPage(view, config) {
    config = config || {};
    view.querySelector("#txtEnabled").checked = config.Enabled !== false;
    view.querySelector("#txtEnableMoveLinksUp").checked = config.EnableMoveLinksUp !== false;
    view.querySelector("#selectLinksInsertAfter").value = config.LinksInsertAfter || "recordingEditor";
    view.querySelector("#txtLinksOrder").value = config.LinksOrder != null ? config.LinksOrder : 8;
    view.querySelector("#txtHideLinksHeading").checked = config.HideLinksHeading !== false;
    view.querySelector("#txtAlignLinksLeft").checked = config.AlignLinksLeft !== false;
    view.querySelector("#txtRemoveLinkCommas").checked = config.RemoveLinkCommas !== false;
    view.querySelector("#txtLinksGap").value = config.LinksGap || ".5em";
    view.querySelector("#txtEnableVlcPathLinks").checked = config.EnableVlcPathLinks !== false;
    view.querySelector("#txtVlcUrlTemplate").value = config.VlcUrlTemplate || "cvlc:///file:///{path}";
    view.querySelector("#txtShowVlcIcon").checked = config.ShowVlcIcon !== false;
    view.querySelector("#txtEnableRaisedLinkButtons").checked = config.EnableRaisedLinkButtons !== false;
    view.querySelector("#txtButtonBorderRadius").value = config.ButtonBorderRadius || "1.5em";
    view.querySelector("#txtButtonTextColor").value = config.ButtonTextColor == null ? "#ffffff" : config.ButtonTextColor;
    view.querySelector("#txtButtonCustomCss").value = config.ButtonCustomCss || "";
    syncColorPicker(view);
    view.querySelector("#selectApplyMode").value = config.ApplyMode || "all";
    view.querySelector("#txtAllowedUserNames").value = config.AllowedUserNames || "";
    view.querySelector("#txtAllowedUserIds").value = config.AllowedUserIds || "";
    loadDash(view, config);
  }

  function readPage(view) {
    return readDash(view, {
      Enabled: view.querySelector("#txtEnabled").checked,
      EnableMoveLinksUp: view.querySelector("#txtEnableMoveLinksUp").checked,
      LinksInsertAfter: view.querySelector("#selectLinksInsertAfter").value,
      LinksOrder: parseInt(view.querySelector("#txtLinksOrder").value, 10) || 8,
      HideLinksHeading: view.querySelector("#txtHideLinksHeading").checked,
      AlignLinksLeft: view.querySelector("#txtAlignLinksLeft").checked,
      RemoveLinkCommas: view.querySelector("#txtRemoveLinkCommas").checked,
      LinksGap: view.querySelector("#txtLinksGap").value,
      EnableVlcPathLinks: view.querySelector("#txtEnableVlcPathLinks").checked,
      VlcUrlTemplate: view.querySelector("#txtVlcUrlTemplate").value,
      ShowVlcIcon: view.querySelector("#txtShowVlcIcon").checked,
      EnableRaisedLinkButtons: view.querySelector("#txtEnableRaisedLinkButtons").checked,
      ButtonBorderRadius: view.querySelector("#txtButtonBorderRadius").value,
      ButtonTextColor: view.querySelector("#txtButtonTextColor").value.trim(),
      ButtonCustomCss: view.querySelector("#txtButtonCustomCss").value,
      ApplyMode: view.querySelector("#selectApplyMode").value,
      AllowedUserNames: view.querySelector("#txtAllowedUserNames").value,
      AllowedUserIds: view.querySelector("#txtAllowedUserIds").value
    });
  }

  // Emby require() uses deps[0] as the controller constructor.
  // Do NOT use exports.default here — that makes .prototype undefined and crashes on onResume.
  function View(view, params) {
    wireColorPicker(view);
    wireDash(view);
    var form = view.querySelector("form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var over = overRows(dashState(view).list);
        if (over.length) {
          var msg = "Dashboard layout: " + over.map(function (x) { return "row " + x.row + " adds up to " + x.sum + "/12"; }).join(", ") + ". Fix the widths before saving.";
          if (typeof Dashboard !== "undefined" && Dashboard.alert) Dashboard.alert({ message: msg }); else window.alert(msg);
          return false;
        }
        var config = readPage(view);
        ApiClient.updatePluginConfiguration(pluginId, config).then(function () {
          Dashboard.processServerConfigurationUpdateResult();
        });
        return false;
      });
    }

    view.addEventListener("viewshow", function () {
      Dashboard.showLoadingMsg();
      ApiClient.getPluginConfiguration(pluginId).then(
        function (config) {
          loadPage(view, config);
          Dashboard.hideLoadingMsg();
        },
        function () {
          loadPage(view, {});
          Dashboard.hideLoadingMsg();
        }
      );
    });
  }

  View.dashHelpers = { normalize: dashNormalize, move: moveSection, nudge: nudge, overRows: overRows, preset: DASH_PRESET };
  return View;
});