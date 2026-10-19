/* Peta Dunia: the script embedded in peta-dunia.svg.
 *
 * Every country is a <g> whose id is its ISO 3166-1 alpha-3 code; every first-level
 * sub-region inside it is a <path> whose id is its ISO 3166-2 code (or Natural Earth's
 * adm1_code where no unique ISO code exists). Click or press Enter on any region and a
 * small panel opens inside the SVG with a chart drawn from the data:
 *   1. the JSON embedded in <script id="pd-data"> (always there, so it works offline), or
 *   2. an external JSON named by data-src="…" on the <svg>, by ?data=… on the SVG's URL,
 *      or passed to PetaDunia.load(urlOrObject) from the host page.
 * No dependencies. Works opened directly, in <object>/<embed>/<iframe>, or pasted inline.
 */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var script = document.currentScript;
  var svg = (script && script.closest && script.closest("svg.pd")) || document.querySelector("svg.pd");
  if (!svg || svg.__pd) return;
  svg.__pd = true;
  var doc = svg.ownerDocument;
  var win = doc.defaultView || window;
  var standalone = doc.documentElement === svg;
  var framed = win.parent !== win || !standalone;
  var VB = svg.viewBox.baseVal;
  var MAXK = 32;
  var mq = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(mq && mq.matches); }

  function q(sel) { return svg.querySelector(sel); }
  function byId(id) { return svg.querySelector('[id="' + String(id).replace(/"/g, "") + '"]'); }
  function el(tag, attrs, parent, text) {
    var n = doc.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var vp = q("#pd-viewport");
  var map = q("#pd-map");
  var ui = q("#pd-ui");
  var hlSel = q("#pd-hl-sel");
  var hlFocus = q("#pd-hl-focus");
  var hlFocusIn = q("#pd-hl-focus-in");
  var paths = Array.prototype.slice.call(map.querySelectorAll("path"));
  var indexOf = new Map();
  paths.forEach(function (p, i) {
    indexOf.set(p, i);
    p.setAttribute("role", "button");
    p.setAttribute("tabindex", i === 0 ? "0" : "-1");
  });
  var roving = paths[0];
  // The root is never a Tab stop of its own: Tab lands straight on a region.
  svg.setAttribute("tabindex", "-1");
  svg.addEventListener("focus", function (e) { if (e.target === svg) roving.focus({ preventScroll: true }); });

  // ------------------------------------------------------------------ data
  function readEmbedded() {
    var n = q("#pd-data");
    try { return JSON.parse(n.textContent); } catch (e) { return { regions: {} }; }
  }
  var DATA = readEmbedded();

  function setData(d) {
    if (!d || typeof d !== "object" || typeof d.regions !== "object") {
      throw new Error("Peta Dunia: data needs a \"regions\" object");
    }
    DATA = d;
    markData();
    attribution();
    if (sel) render();
    emit("petadunia:data", { regions: Object.keys(d.regions).length });
  }

  function load(src) {
    if (src && typeof src === "object") { setData(src); return Promise.resolve(DATA); }
    return fetch(src, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Peta Dunia: " + r.status + " loading " + src);
      return r.json();
    }).then(function (d) { setData(d); return DATA; });
  }

  function externalSource() {
    var src = svg.getAttribute("data-src");
    if (standalone) {
      try { src = new URLSearchParams(win.location.search).get("data") || src; } catch (e) { /* old browser */ }
    }
    if (!src) return null;
    var url;
    try { url = new URL(src, doc.baseURI || win.location.href); } catch (e) { return null; }
    // Browsers refuse fetch() from file:// pages; keep the embedded data instead of logging an error.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  }

  function entry(id) {
    var r = DATA.regions && DATA.regions[id];
    return r && Array.isArray(r.charts) ? r : null;
  }
  function hasCharts(id) { var r = entry(id); return !!(r && r.charts.length); }

  function markData() {
    paths.forEach(function (p) { p.classList.toggle("pd-d", hasCharts(p.id)); });
    legend();
  }

  // ------------------------------------------------------------------ region info
  function info(p) {
    var g = p.parentNode;
    return {
      id: p.id,
      name: p.getAttribute("aria-label"),
      countryId: g.id,
      country: g.getAttribute("aria-label"),
      single: g.childElementCount === 1 || p.getAttribute("aria-label") === g.getAttribute("aria-label")
    };
  }

  // ------------------------------------------------------------------ view (pan / zoom)
  var view = { k: 1, x: 0, y: 0 };
  var anim = 0;

  function clampView(v) {
    v.k = Math.max(1, Math.min(MAXK, v.k));
    var minX = VB.width * (1 - v.k), minY = VB.height * (1 - v.k);
    v.x = Math.min(0, Math.max(minX, v.x));
    v.y = Math.min(0, Math.max(minY, v.y));
    return v;
  }
  function applyView() {
    vp.setAttribute("transform", "translate(" + view.x.toFixed(2) + "," + view.y.toFixed(2) + ") scale(" + view.k.toFixed(4) + ")");
    if (sel && W) { anchor = null; position(); } // the panel follows its region when the view moves
    svg.style.touchAction = view.k > 1.01 ? "none" : "pan-y";
    svg.classList.toggle("pd-z2", view.k >= 3 && view.k < 10);
    svg.classList.toggle("pd-z3", view.k >= 10);
    placeLocator();
  }
  function setView(v, animate) {
    var to = clampView({ k: v.k, x: v.x, y: v.y });
    if (anim) win.cancelAnimationFrame(anim);
    if (!animate || reduced()) { view = to; applyView(); return; }
    var from = { k: view.k, x: view.x, y: view.y }, t0 = 0, dur = 320;
    function step(t) {
      if (!t0) t0 = t;
      var u = Math.min(1, (t - t0) / dur);
      var e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      applyView();
      anim = u < 1 ? win.requestAnimationFrame(step) : 0;
    }
    anim = win.requestAnimationFrame(step);
  }
  function zoomAt(ux, uy, f, animate) {
    var k = Math.max(1, Math.min(MAXK, view.k * f));
    var r = k / view.k;
    setView({ k: k, x: ux - (ux - view.x) * r, y: uy - (uy - view.y) * r }, animate);
  }
  function toUser(cx, cy) {
    var m = svg.getScreenCTM();
    return m ? { x: (cx - m.e) / m.a, y: (cy - m.f) / m.d } : { x: 0, y: 0 };
  }
  function visibleBox() {
    // The part of user space actually on screen (wider than the viewBox when letterboxed).
    var r = svg.getBoundingClientRect(), a = toUser(r.left, r.top), b = toUser(r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }
  function centre() { var b = visibleBox(); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  function zoomBy(f) { var c = centre(); zoomAt(c.x, c.y, f, true); }
  function resetView() { setView({ k: 1, x: 0, y: 0 }, true); }

  function regionBox(p) {
    var b = p.getBBox();
    return { x: b.x * view.k + view.x, y: b.y * view.k + view.y, w: b.width * view.k, h: b.height * view.k };
  }
  function ensureVisible(p) {
    var b = regionBox(p), v = visibleBox(), m = 0.08;
    var inside = b.x >= v.x + v.w * m && b.y >= v.y + v.h * m &&
      b.x + b.w <= v.x + v.w * (1 - m) && b.y + b.h <= v.y + v.h * (1 - m);
    if (inside || view.k === 1 && b.w < v.w) return;
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, c = centre();
    setView({ k: view.k, x: view.x + (c.x - cx), y: view.y + (c.y - cy) }, true);
  }
  function zoomToRegion(p, fill) {
    var bb = p.getBBox(), v = visibleBox();
    var k = Math.max(1, Math.min(MAXK, (fill || 0.5) * Math.min(v.w / Math.max(bb.width, 1), v.h / Math.max(bb.height, 1))));
    var c = centre();
    setView({ k: k, x: c.x - (bb.x + bb.width / 2) * k, y: c.y - (bb.y + bb.height / 2) * k }, true);
  }

  // ------------------------------------------------------------------ overlay (screen pixels)
  var W = 0, H = 0, s = 1;
  var gRead = el("g", { "class": "pd-read", "aria-hidden": "true", visibility: "hidden" }, ui);
  var readPlate = el("rect", { "class": "pd-plate", height: 28 }, gRead);
  var readText = el("text", { x: 10, y: 19 }, gRead);
  var gHint = el("g", { "class": "pd-hint", "aria-hidden": "true", opacity: 0 }, ui);
  var hintPlate = el("rect", { "class": "pd-plate", height: 32 }, gHint);
  var hintText = el("text", { x: 12, y: 21 }, gHint, (/Mac|iP/.test(win.navigator.platform) ? "⌘" : "Ctrl") + " + scroll to zoom");
  var gLegend = el("g", { "class": "pd-attr", "aria-hidden": "true" }, ui);
  var gAttr = el("text", { "class": "pd-attr pd-soft" }, ui);
  var gLoc = el("g", { "aria-hidden": "true", visibility: "hidden", "pointer-events": "none" }, ui);
  el("circle", { r: 13, fill: "none", stroke: "#fff", "stroke-width": 5 }, gLoc);
  el("circle", { r: 13, fill: "none", stroke: "#161616", "stroke-width": 2 }, gLoc);

  function button(parent, label, act, w, h) {
    var b = el("g", { "class": "pd-btn", role: "button", tabindex: 0, "aria-label": label, "data-act": act }, parent);
    el("rect", { width: w, height: h }, b);
    return b;
  }
  var gCtl = el("g", { "class": "pd-ctl", role: "group", "aria-label": "Zoom" }, ui);
  var bIn = button(gCtl, "Zoom in", "in", 32, 32);
  el("path", { "class": "pd-ico", d: "M10 16h12M16 10v12" }, bIn);
  var bOut = button(gCtl, "Zoom out", "out", 32, 32);
  bOut.setAttribute("transform", "translate(0,32)");
  el("path", { "class": "pd-ico", d: "M10 16h12" }, bOut);
  var bReset = button(gCtl, "Reset view", "reset", 32, 32);
  bReset.setAttribute("transform", "translate(0,72)");
  el("path", { "class": "pd-ico", d: "M9 13V9h4M19 9h4v4M23 19v4h-4M13 23H9v-4" }, bReset);

  function textWidth(t) { try { return t.getComputedTextLength(); } catch (e) { return t.textContent.length * 7; } }
  function fit(t, max) {
    var full = t.textContent;
    if (textWidth(t) <= max) return;
    var lo = 0, hi = full.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      t.textContent = full.slice(0, mid) + "…";
      if (textWidth(t) <= max) lo = mid; else hi = mid - 1;
    }
    t.textContent = full.slice(0, Math.max(1, lo)) + "…";
  }

  function layoutUI() {
    var m = svg.getScreenCTM();
    if (!m || !m.a) return;
    var r = svg.getBoundingClientRect();
    W = r.width; H = r.height; s = m.a;
    ui.setAttribute("transform", "translate(" + ((r.left - m.e) / m.a) + "," + ((r.top - m.f) / m.d) + ") scale(" + (1 / m.a) + ")");
    gCtl.setAttribute("transform", "translate(" + (W - 44) + ",12)");
    gRead.setAttribute("transform", "translate(12,12)");
    attribution();
    legend();
    if (sel) position();
    placeLocator();
  }

  function attribution() {
    var names = ["Boundaries: Natural Earth"];
    var src = DATA.sources || {};
    var list = Object.keys(src).map(function (k) { return src[k].short || src[k].name; }).filter(Boolean);
    if (list.length) names.push("Data: " + list.join(", "));
    gAttr.textContent = names.join(" · ");
    gAttr.setAttribute("x", 12);
    gAttr.setAttribute("y", H - 12);
    fit(gAttr, Math.max(60, W - 24));
  }

  function legend() {
    clear(gLegend);
    if (!W) return;
    var any = paths.some(function (p) { return p.classList.contains("pd-d"); });
    if (!any) return;
    gLegend.setAttribute("transform", "translate(12," + (H - 38) + ")");
    el("rect", { width: 10, height: 10, y: 0, fill: "#a6c8ff" }, gLegend);
    el("text", { x: 16, y: 9, "class": "pd-soft" }, gLegend, "Has its own sub-region data");
  }

  function showRead(p) {
    if (!p) { gRead.setAttribute("visibility", "hidden"); return; }
    var i = info(p);
    readText.textContent = i.single || i.name === i.country ? i.country : i.name + " · " + i.country;
    fit(readText, Math.max(80, W - 100));
    readPlate.setAttribute("width", textWidth(readText) + 20);
    gRead.setAttribute("visibility", "visible");
  }

  var hintTimer = 0;
  function hint() {
    hintPlate.setAttribute("width", textWidth(hintText) + 24);
    var w = textWidth(hintText) + 24;
    gHint.setAttribute("transform", "translate(" + Math.max(8, (W - w) / 2) + "," + Math.max(8, H / 2 - 16) + ")");
    gHint.setAttribute("opacity", 1);
    win.clearTimeout(hintTimer);
    hintTimer = win.setTimeout(function () { gHint.setAttribute("opacity", 0); }, 1200);
  }

  var focusVisible = false;
  function placeLocator() {
    var p = doc.activeElement;
    if (!W || !p || !indexOf.has(p) || !focusVisible) { gLoc.setAttribute("visibility", "hidden"); return; }
    var b = regionBox(p);
    var px = b.w * s, py = b.h * s;
    if (px > 14 && py > 14) { gLoc.setAttribute("visibility", "hidden"); return; }
    gLoc.setAttribute("transform", "translate(" + ((b.x + b.w / 2) * s + offX()) + "," + ((b.y + b.h / 2) * s + offY()) + ")");
    gLoc.setAttribute("visibility", "visible");
  }
  // user-space -> overlay pixel offsets
  function offX() { var m = svg.getScreenCTM(), r = svg.getBoundingClientRect(); return m.e - r.left; }
  function offY() { var m = svg.getScreenCTM(), r = svg.getBoundingClientRect(); return m.f - r.top; }

  // ------------------------------------------------------------------ number formatting
  var compact = typeof Intl !== "undefined" && Intl.NumberFormat ?
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }) : null;
  var plain = typeof Intl !== "undefined" && Intl.NumberFormat ?
    new Intl.NumberFormat("en", { maximumFractionDigits: 1 }) : null;
  function num(v) {
    if (v == null || !isFinite(v)) return "–";
    var a = Math.abs(v);
    if (a >= 10000) return compact ? compact.format(v) : String(Math.round(v));
    return plain ? plain.format(v) : String(Math.round(v * 10) / 10);
  }
  function fmt(c, v) {
    var u = c.unit || "";
    var pre = c.prefix != null ? c.prefix : /^(US\$|\$|RM|€|£|¥)$/.test(u) ? u : "";
    var suf = c.suffix != null ? c.suffix : pre || !u || u === "people" ? "" : u === "%" ? "%" : " " + u;
    return pre + num(v) + suf;
  }
  function niceTicks(lo, hi, n) {
    if (lo === hi) { hi = lo + (lo === 0 ? 1 : Math.abs(lo) * .1); lo = lo - (lo === 0 ? 0 : Math.abs(lo) * .1); }
    var raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), e = raw / p;
    var step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * p;
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, t = [];
    for (var v = a; v <= b + step / 2; v += step) t.push(Math.round(v / step) * step);
    return t;
  }

  // ------------------------------------------------------------------ panel
  var panel = el("g", { id: "pd-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "pd-ptitle" });
  ui.insertBefore(panel, gCtl); // Tab from the selected region reaches the chart before the zoom buttons
  var card = el("g", { "class": "pd-card" }, panel);
  var sel = null;          // selected path
  var scope = "region";    // "region" | "country"
  var tab = 0;
  var anchor = null;       // {x,y} in overlay pixels
  var PW = 320, PH = 0;

  function sources(id) { return (DATA.sources || {})[id] || null; }

  function select(p, opts) {
    opts = opts || {};
    if (!p) return;
    if (sel && sel !== p) sel.classList.remove("pd-sel"), sel.removeAttribute("aria-expanded");
    sel = p;
    p.classList.add("pd-sel");
    p.setAttribute("aria-expanded", "true");
    p.setAttribute("aria-controls", "pd-panel");
    hlSel.setAttribute("d", p.getAttribute("d"));
    var i = info(p);
    scope = hasCharts(i.id) || i.single ? "region" : hasCharts(i.countryId) ? "country" : "region";
    if (i.single && !hasCharts(i.id) && hasCharts(i.countryId)) scope = "country";
    tab = 0;
    anchor = opts.anchor || null;
    render();
    panel.classList.remove("pd-open");
    void panel.getBoundingClientRect();
    panel.classList.add("pd-open");
    emit("petadunia:select", { id: i.id, name: i.name, countryId: i.countryId, country: i.country });
  }

  function close(returnFocus) {
    if (!sel) return;
    var p = sel;
    sel.classList.remove("pd-sel");
    sel.removeAttribute("aria-expanded");
    sel = null;
    hlSel.removeAttribute("d");
    panel.classList.remove("pd-open");
    gCtl.setAttribute("visibility", "visible");
    clear(card);
    if (returnFocus) focusRegion(p, false);
    emit("petadunia:close", { id: p.id });
  }

  function current() {
    var i = info(sel);
    var id = scope === "country" ? i.countryId : i.id;
    var e = entry(id);
    return { i: i, id: id, e: e, charts: e ? e.charts.filter(validChart) : [] };
  }
  function validChart(c) { return c && Array.isArray(c.values) && c.values.length > 0; }

  function render() {
    clear(card);
    if (!sel) return;
    var cur = current(), i = cur.i;
    PW = W < 560 ? Math.min(W - 16, 440) : 344;
    var pad = 16, inner = PW - pad * 2, y = 0;
    var plate = el("rect", { "class": "pd-plate", width: PW }, card);

    // Title + close
    var title = scope === "country" ? i.country : (cur.e && cur.e.name) || i.name;
    var t = el("text", { id: "pd-ptitle", "class": "pd-title", x: pad, y: 30 }, card, title);
    fit(t, inner - 36);
    var cs = W < 560 ? 44 : 32; // a full touch target on phones
    var bClose = button(card, "Close chart", "close", cs, cs);
    bClose.setAttribute("transform", "translate(" + (PW - cs - 8) + "," + (W < 560 ? 4 : 8) + ")");
    el("path", { "class": "pd-ico", d: "M11 11l10 10M21 11L11 21", transform: "translate(" + (cs - 32) / 2 + "," + (cs - 32) / 2 + ")" }, bClose);
    var subTxt = scope === "country" ? "Country · " + i.countryId : (i.single ? "" : i.country + " · ") + i.id;
    var sub = el("text", { "class": "pd-sub pd-mute", x: pad, y: 48 }, card, subTxt);
    fit(sub, inner - 36);
    y = 60;

    // Scope switch: this region / its country
    if (!i.single) {
      y += 4;
      y = toggles(card, "pd-seg", [
        { label: i.name, on: scope === "region", act: "scope:region", hint: hasCharts(i.id) ? "" : "no data" },
        { label: i.country, on: scope === "country", act: "scope:country", hint: hasCharts(i.countryId) ? "" : "no data" }
      ], pad, y, inner, "Show figures for");
    }

    // Chart tabs
    var charts = cur.charts;
    if (tab >= charts.length) tab = 0;
    if (charts.length > 1) {
      y += 4;
      y = toggles(card, "pd-tab", charts.map(function (c, n) {
        return { label: c.short || String(c.title || "Chart " + (n + 1)).split(",")[0], on: n === tab, act: "tab:" + n };
      }), pad, y, inner, "Chart");
    }

    var g = el("g", { transform: "translate(" + pad + "," + (y + 12) + ")" }, card);
    var h = charts.length ? chart(g, charts[tab], inner) : noData(g, inner, scope === "country" ? i.countryId : i.id);
    y += 12 + h;

    // Source line
    var c = charts[tab], src = c && sources(c.source);
    var srcText = c ? (src ? "Source: " + (src.short || src.name) + (src.licence ? " · " + src.licence : "") : DATA.mock ? "Mock data, not real figures" : "Source: your data") : "";
    if (c && (DATA.mock || (src && src.mock))) srcText = "Mock data, not real figures";
    if (srcText) {
      var st = el("text", { "class": "pd-sub pd-soft", x: pad, y: y + 22 }, card, srcText);
      fit(st, inner);
      y += 30;
    }
    PH = y + 12;
    plate.setAttribute("height", PH);
    panel.setAttribute("aria-label", "Chart for " + title);
    position();
  }

  function toggles(parent, cls, items, x, y, inner, label) {
    var row = el("g", { role: "group", "aria-label": label, transform: "translate(" + x + "," + y + ")" }, parent);
    var seg = cls === "pd-seg", h = seg ? 28 : 32, pad = seg ? 10 : 8, n = items.length, made = [];
    items.forEach(function (it) {
      var b = el("g", { "class": cls, role: "button", tabindex: 0, "aria-pressed": it.on ? "true" : "false", "data-act": it.act }, row);
      if (it.hint) b.setAttribute("aria-label", it.label + " (" + it.hint + ")");
      made.push({ b: b, bg: el("rect", { height: h }, b), t: el("text", { x: pad, y: seg ? 18 : 20 }, b, it.label) });
    });
    // Natural widths first; if the row overflows, share the width evenly and truncate.
    var nat = made.map(function (m) { return textWidth(m.t) + pad * 2; });
    var total = nat.reduce(function (a, w) { return a + w; }, 0);
    var widths = total <= inner ? nat.map(function (w) { return w + (inner - total) / n; }) : made.map(function (m) {
      fit(m.t, inner / n - pad * 2);
      return inner / n;
    });
    var cx = 0;
    made.forEach(function (m, k) {
      var w = widths[k];
      m.b.setAttribute("transform", "translate(" + cx.toFixed(1) + ",0)");
      m.bg.setAttribute("width", w);
      if (!seg) {
        el("rect", { "class": "pd-bar-off", y: 30, width: w, height: 2 }, m.b);
        el("rect", { "class": "pd-bar-on", y: 30, width: w, height: 2 }, m.b);
      }
      cx += w;
    });
    return y + h;
  }

  function position() {
    if (!sel || !W) return;
    var sc = Math.min(1, (H - 16) / PH, (W - 16) / PW);
    var w = PW * sc, h = PH * sc, x, y;
    var a = anchor || regionAnchor(sel);
    // Docked panels span the width, so the zoom buttons step aside until the panel closes.
    gCtl.setAttribute("visibility", W < 560 ? "hidden" : "visible");
    if (W < 560) {
      // Phones: dock to the bottom edge, or to the top when the region sits in the lower half.
      x = (W - w) / 2; y = a.y > H / 2 ? 8 : H - h - 8;
    } else {
      x = a.x + 20;
      if (x + w > W - 56) x = a.x - 20 - w;
      x = Math.max(8, Math.min(W - 56 - w, x));
      y = Math.max(8, Math.min(H - h - 8, a.y - h / 2));
    }
    panel.setAttribute("transform", "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ") scale(" + sc.toFixed(3) + ")");
  }
  function regionAnchor(p) {
    var b = regionBox(p);
    return { x: (b.x + b.w / 2) * s + offX(), y: (b.y + b.h / 2) * s + offY() };
  }

  // ------------------------------------------------------------------ charts
  function seriesLabels(c) {
    if (Array.isArray(c.labels)) return c.labels.map(String);
    var start = Number(c.start);
    return c.values.map(function (_, n) { return isFinite(start) ? String(start + n) : String(n + 1); });
  }

  function kpi(g, c, w, v, label) {
    clear(g);
    el("text", { "class": "pd-kpi", x: 0, y: 22 }, g, fmt(c, v));
    var l = el("text", { "class": "pd-kpi-l pd-mute", x: 0, y: 40 }, g, label);
    fit(l, w);
  }

  function chart(g, c, w) {
    var labels = seriesLabels(c);
    var vals = c.values.map(function (v) { return v == null || v === "" ? null : Number(v); });
    var cat = Array.isArray(c.labels) && c.type === "bar" && !c.start;
    if (cat) return hbars(g, c, w, labels, vals);
    var last = vals.length - 1;
    while (last > 0 && (vals[last] == null || !isFinite(vals[last]))) last--;
    var gk = el("g", null, g);
    function showKpi(n) { kpi(gk, c, w, vals[n], (c.title || "") + (labels[n] ? " \u00b7 " + labels[n] : "")); }
    showKpi(last);

    var top = 54, ph = W < 560 ? 84 : 108, axisW = 44, pw = w - axisW, x0 = axisW;
    var fin = vals.filter(function (v) { return v != null && isFinite(v); });
    var lo = Math.min.apply(null, fin), hi = Math.max.apply(null, fin);
    if (c.type === "bar") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    var ticks = niceTicks(lo, hi, 3), t0 = ticks[0], t1 = ticks[ticks.length - 1];
    function Y(v) { return top + ph - (v - t0) / (t1 - t0 || 1) * ph; }
    var n = vals.length;
    var band = pw / n;
    function X(i) { return c.type === "bar" ? x0 + band * (i + .5) : x0 + (n === 1 ? pw / 2 : pw * i / (n - 1)); }

    var plot = el("g", { role: "img", "aria-label": summary(c, labels, vals) }, g);
    ticks.forEach(function (tv) {
      el("line", { "class": tv === 0 && c.type === "bar" ? "pd-base" : "pd-grid", x1: x0, x2: x0 + pw, y1: Y(tv), y2: Y(tv) }, plot);
      el("text", { "class": "pd-ax", x: x0 - 6, y: Y(tv) + 4, "text-anchor": "end" }, plot, fmtAxis(c, tv));
    });

    var bars = [];
    if (c.type === "bar") {
      var bw = Math.max(1, band * .72);
      vals.forEach(function (v, i) {
        if (v == null || !isFinite(v)) { bars.push(null); return; }
        var y1 = Y(Math.max(0, v)), y2 = Y(Math.min(0, v));
        var r = el("rect", { "class": "pd-bar", x: (X(i) - bw / 2).toFixed(2), y: y1.toFixed(2), width: bw.toFixed(2), height: Math.max(.5, y2 - y1).toFixed(2) }, plot);
        r.style.animationDelay = Math.min(i * 18, 400) + "ms";
        bars.push(r);
      });
    } else {
      var d = "", area = "", started = false, first = null, prev = null;
      vals.forEach(function (v, i) {
        if (v == null || !isFinite(v)) { started = false; return; }
        var px = X(i).toFixed(2), py = Y(v).toFixed(2);
        d += (started ? "L" : "M") + px + " " + py;
        area += (first == null ? "M" + px + " " + (top + ph) + "L" : "L") + px + " " + py;
        if (first == null) first = i;
        prev = i; started = true;
      });
      if (prev != null) area += "L" + X(prev).toFixed(2) + " " + (top + ph) + "Z";
      el("path", { "class": "pd-area", d: area }, plot);
      el("path", { "class": "pd-line", d: d, pathLength: 1 }, plot);
      el("circle", { "class": "pd-dot", cx: X(last), cy: Y(vals[last]), r: 4 }, plot);
    }
    // x labels: first, middle, last
    var picks = n > 2 ? [0, Math.round((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
    picks.forEach(function (i, k) {
      el("text", { "class": "pd-ax", x: X(i), y: top + ph + 16, "text-anchor": k === 0 && picks.length > 1 ? "start" : k === picks.length - 1 && picks.length > 1 ? "end" : "middle" }, plot, labels[i]);
    });
    // Scrub: hover/drag to read any point.
    var guide = el("line", { "class": "pd-guide", y1: top, y2: top + ph, visibility: "hidden" }, plot);
    var dot = c.type === "bar" ? null : el("circle", { "class": "pd-dot", r: 4, visibility: "hidden" }, plot);
    var hit = el("rect", { "class": "pd-hit", x: x0, y: top, width: pw, height: ph }, plot);
    var hot = null;
    function at(ev) {
      var m = hit.getScreenCTM();
      if (!m) return;
      var lx = (ev.clientX - m.e) / m.a;
      var i = c.type === "bar" ? Math.floor((lx - x0) / band) : Math.round((lx - x0) / (pw / Math.max(1, n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      if (vals[i] == null || !isFinite(vals[i])) return;
      showKpi(i);
      if (hot) hot.classList.remove("pd-hot");
      if (bars[i]) { hot = bars[i]; hot.classList.add("pd-hot"); guide.setAttribute("visibility", "hidden"); }
      else {
        guide.setAttribute("x1", X(i)); guide.setAttribute("x2", X(i)); guide.setAttribute("visibility", "visible");
        if (dot) { dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(vals[i])); dot.setAttribute("visibility", "visible"); }
      }
    }
    hit.addEventListener("pointermove", at);
    hit.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); at(ev); });
    hit.addEventListener("pointerleave", function () {
      showKpi(last);
      if (hot) hot.classList.remove("pd-hot"), hot = null;
      guide.setAttribute("visibility", "hidden");
      if (dot) dot.setAttribute("visibility", "hidden");
    });
    return top + ph + 22;
  }

  function hbars(g, c, w, labels, vals) {
    var rows = [];
    labels.forEach(function (l, i) { if (vals[i] != null && isFinite(vals[i])) rows.push([l, vals[i]]); });
    if (c.sort !== false) rows.sort(function (a, b) { return b[1] - a[1]; });
    rows = rows.slice(0, 8);
    var total = rows.reduce(function (a, r) { return a + r[1]; }, 0);
    var gk = el("g", null, g);
    kpi(gk, c, w, total, (c.title || "") + " \u00b7 total");
    var top = 54, rh = 22, lw = Math.min(124, w * .4), vw = 52, bw = w - lw - vw;
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r[1]); })) || 1;
    var plot = el("g", { role: "img", "aria-label": (c.title || "Chart") + ": " + rows.map(function (r) { return r[0] + " " + fmt(c, r[1]); }).join(", ") }, g);
    rows.forEach(function (r, i) {
      var y = top + i * rh;
      var t = el("text", { "class": "pd-ax", x: 0, y: y + 15 }, plot, r[0]);
      fit(t, lw - 8);
      var len = Math.max(1, Math.abs(r[1]) / max * bw);
      var b = el("rect", { "class": "pd-bar pd-hbar", x: lw, y: y + 4, width: len.toFixed(2), height: rh - 8 }, plot);
      b.style.animationDelay = i * 50 + "ms";
      el("text", { "class": "pd-val pd-mute", x: lw + len + 6, y: y + 15 }, plot, fmtAxis(c, r[1]));
      (function (row, bar) {
        bar.addEventListener("pointerenter", function () { bar.classList.add("pd-hot"); kpi(gk, c, w, row[1], row[0] + (total ? " · " + Math.round(row[1] / total * 100) + "%" : "")); });
        bar.addEventListener("pointerleave", function () { bar.classList.remove("pd-hot"); kpi(gk, c, w, total, (c.title || "") + " \u00b7 total"); });
      })(r, b);
    });
    return top + rows.length * rh + 4;
  }

  function fmtAxis(c, v) {
    var u = c.unit || "";
    var pre = c.prefix != null ? c.prefix : /^(US\$|\$|RM|€|£|¥)$/.test(u) ? (u === "US$" ? "$" : u) : "";
    return pre + (compact && Math.abs(v) >= 1000 ? compact.format(v) : num(v)) + (u === "%" ? "%" : "");
  }

  function summary(c, labels, vals) {
    var f = -1, l = -1;
    vals.forEach(function (v, i) { if (v != null && isFinite(v)) { if (f < 0) f = i; l = i; } });
    if (f < 0) return (c.title || "Chart") + ": no values";
    return (c.title || "Chart") + ", " + labels[f] + " to " + labels[l] + ": from " + fmt(c, vals[f]) + " to " + fmt(c, vals[l]);
  }

  function noData(g, w, id) {
    var top = 4, ph = W < 560 ? 96 : 120, n = 8, gap = 6, bw = (w - gap * (n - 1)) / n;
    var hs = [.22, .34, .28, .42, .36, .48, .44, .56];
    var plot = el("g", { role: "img", "aria-label": "No data for this region" }, g);
    hs.forEach(function (h, i) {
      el("rect", { "class": "pd-ghost", x: i * (bw + gap), y: top + ph * (1 - h), width: bw, height: ph * h }, plot);
    });
    el("line", { "class": "pd-base", x1: 0, x2: w, y1: top + ph, y2: top + ph }, plot);
    el("text", { "class": "pd-nd", x: 0, y: top + 18 }, plot, "No data for this region");
    var t = el("text", { "class": "pd-sub pd-mute", x: 0, y: top + 38 }, plot, "Add “" + id + "” to the JSON to chart it");
    fit(t, w);
    return top + ph + 4;
  }

  // ------------------------------------------------------------------ actions
  function act(a) {
    if (a === "in") return zoomBy(2);
    if (a === "out") return zoomBy(.5);
    if (a === "reset") return resetView();
    if (a === "close") return close(true);
    if (a.indexOf("scope:") === 0) { scope = a.slice(6); tab = 0; render(); return focusAct(a); }
    if (a.indexOf("tab:") === 0) { tab = Number(a.slice(4)) || 0; render(); return focusAct(a); }
  }
  function focusAct(a) {
    var b = card.querySelector('[data-act="' + a + '"]');
    if (b) b.focus({ preventScroll: true });
  }

  function focusRegion(p, visible) {
    if (!p) return;
    if (roving && roving !== p) roving.setAttribute("tabindex", "-1");
    roving = p;
    p.setAttribute("tabindex", "0");
    focusVisible = visible !== false;
    quiet = !focusVisible;
    p.focus({ preventScroll: true });
    quiet = false;
    if (focusVisible) ensureVisible(p);
    highlightFocus();
  }
  function highlightFocus() {
    var p = doc.activeElement;
    if (p && indexOf.has(p) && focusVisible) {
      hlFocus.setAttribute("d", p.getAttribute("d"));
      hlFocusIn.setAttribute("d", p.getAttribute("d"));
      showRead(p);
    } else {
      hlFocus.removeAttribute("d");
      hlFocusIn.removeAttribute("d");
    }
    placeLocator();
  }

  // Geographic arrow-key movement: nearest region centre in the pressed direction.
  var centres = null;
  function getCentres() {
    if (!centres) centres = paths.map(function (p) { var b = p.getBBox(); return [b.x + b.width / 2, b.y + b.height / 2]; });
    return centres;
  }
  function nearest(i, dx, dy) {
    var c = getCentres(), ox = c[i][0], oy = c[i][1], best = -1, bs = Infinity;
    for (var j = 0; j < c.length; j++) {
      if (j === i) continue;
      var vx = c[j][0] - ox, vy = c[j][1] - oy;
      var along = vx * dx + vy * dy;
      if (along <= 0.01) continue;
      var score = along + Math.abs(vx * dy - vy * dx) * 2.5;
      if (score < bs) { bs = score; best = j; }
    }
    return best < 0 ? null : paths[best];
  }
  function strip(t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  var typed = "", typedAt = 0;
  function typeAhead(ch, from) {
    var now = Date.now();
    typed = now - typedAt > 700 ? ch : typed + ch;
    typedAt = now;
    var start = typed.length === 1 ? from + 1 : from, n = paths.length;
    for (var k = 0; k < n; k++) {
      var p = paths[(start + k) % n], i = info(p);
      if (strip(i.country).indexOf(typed) === 0 || strip(i.name).indexOf(typed) === 0) return p;
    }
    return null;
  }
  function nextCountry(i, dir) {
    var g = paths[i].parentNode, sib = dir > 0 ? g.nextElementSibling : g.previousElementSibling;
    if (!sib) sib = dir > 0 ? map.firstElementChild : map.lastElementChild;
    return sib.firstElementChild;
  }

  // ------------------------------------------------------------------ events
  function emit(type, detail) {
    try { svg.dispatchEvent(new CustomEvent(type, { detail: detail, bubbles: true })); } catch (e) { /* very old browser */ }
    if (win.parent !== win) {
      try { win.parent.postMessage({ type: type, detail: detail }, "*"); } catch (e) { /* ignore */ }
    }
  }

  svg.addEventListener("keydown", function (e) {
    var t = e.target, key = e.key;
    if (key === "Escape" && sel) { e.preventDefault(); close(true); return; }
    var a = t.getAttribute && t.getAttribute("data-act");
    if (a && (key === "Enter" || key === " ")) { e.preventDefault(); act(a); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (key === "+" || key === "=") { e.preventDefault(); zoomBy(2); return; }
      if (key === "-" || key === "_") { e.preventDefault(); zoomBy(.5); return; }
      if (key === "0") { e.preventDefault(); resetView(); return; }
    }
    if (!indexOf.has(t)) return;
    var i = indexOf.get(t), next = null;
    switch (key) {
      case "Enter": case " ": e.preventDefault(); select(t); return;
      case "ArrowLeft": next = nearest(i, -1, 0); break;
      case "ArrowRight": next = nearest(i, 1, 0); break;
      case "ArrowUp": next = nearest(i, 0, -1); break;
      case "ArrowDown": next = nearest(i, 0, 1); break;
      case "PageDown": next = nextCountry(i, 1); break;
      case "PageUp": next = nextCountry(i, -1); break;
      case "Home": next = paths[0]; break;
      case "End": next = paths[paths.length - 1]; break;
      default:
        if (key.length === 1 && /\S/.test(key) && !e.ctrlKey && !e.metaKey && !e.altKey) next = typeAhead(strip(key), i);
    }
    if (next) { e.preventDefault(); focusRegion(next, true); }
  });
  var quiet = false; // focus moved by a click or by the API: no keyboard ring
  svg.addEventListener("focusin", function (e) {
    if (indexOf.has(e.target)) {
      var fv = false;
      try { fv = !quiet && e.target.matches(":focus-visible"); } catch (x) { fv = !quiet; }
      focusVisible = fv;
      if (e.target !== roving) { roving.setAttribute("tabindex", "-1"); roving = e.target; roving.setAttribute("tabindex", "0"); }
      highlightFocus();
      if (fv) ensureVisible(e.target);
    }
  });
  svg.addEventListener("focusout", function () { win.setTimeout(highlightFocus, 0); });

  // Pointer: drag to pan, pinch to zoom, tap to select.
  var pts = new Map(), drag = null, moved = false, pinch = null;
  function inUI(t) { return t && t.closest && t.closest("#pd-ui"); }
  svg.addEventListener("pointerdown", function (e) {
    if (e.button > 0 || inUI(e.target)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = false; }
    if (pts.size === 2) {
      var a = Array.from(pts.values());
      pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, k: view.k };
      moved = true;
    }
  });
  svg.addEventListener("pointermove", function (e) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      var a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      var mid = toUser((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
      zoomAt(mid.x, mid.y, (pinch.k * d / pinch.d) / view.k, false);
      return;
    }
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) > 5) {
      moved = true;
      svg.classList.add("pd-drag");
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    }
    if (moved && view.k > 1) {
      var m = svg.getScreenCTM();
      view = clampView({ k: view.k, x: drag.vx + dx / m.a, y: drag.vy + dy / m.d });
      applyView();
    }
  });
  function endPointer(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      if (drag && !moved && e.type === "pointerup") {
        var p = e.target.closest ? e.target.closest("#pd-map path") : null;
        if (p) {
          focusRegion(p, false);
          var r = svg.getBoundingClientRect();
          select(p, { anchor: { x: e.clientX - r.left, y: e.clientY - r.top } });
        } else close(false);
      }
      drag = null;
      svg.classList.remove("pd-drag");
    }
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("dblclick", function (e) {
    if (inUI(e.target)) return;
    var u = toUser(e.clientX, e.clientY);
    zoomAt(u.x, u.y, e.shiftKey ? .5 : 2, true);
  });
  svg.addEventListener("wheel", function (e) {
    if (inUI(e.target) && e.target.closest("#pd-panel")) return;
    if (framed && !e.ctrlKey && !e.metaKey) { hint(); return; }
    e.preventDefault();
    var u = toUser(e.clientX, e.clientY);
    var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(u.x, u.y, Math.exp(-dy * (e.ctrlKey ? .01 : .002)), false);
  }, { passive: false });
  ui.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-act]");
    if (b) act(b.getAttribute("data-act"));
  });
  map.addEventListener("pointerover", function (e) { if (e.pointerType === "mouse" && indexOf.has(e.target)) showRead(e.target); });
  map.addEventListener("pointerout", function (e) {
    if (e.pointerType !== "mouse") return;
    var a = doc.activeElement;
    showRead(indexOf.has(a) && focusVisible ? a : null);
  });

  win.addEventListener("resize", layoutUI);
  if (win.ResizeObserver) new win.ResizeObserver(layoutUI).observe(svg);

  // ------------------------------------------------------------------ public API
  var api = {
    select: function (id) { var p = byId(id); if (p && indexOf.has(p)) { focusRegion(p, false); select(p); return true; } return false; },
    close: function () { close(false); },
    zoomTo: function (id, fill) { var p = byId(id); if (p && (indexOf.has(p) || p.parentNode === map)) zoomToRegion(p, fill); },
    reset: resetView,
    load: load,
    data: function () { return DATA; },
    regions: function () { return paths.map(function (p) { var i = info(p); return { id: i.id, name: i.name, countryId: i.countryId, country: i.country }; }); }
  };
  svg.petaDunia = api;
  if (!win.PetaDunia) win.PetaDunia = api;

  markData();
  layoutUI();
  applyView();
  var ext = externalSource();
  if (ext) load(ext).catch(function (err) { if (win.console) win.console.warn(err.message); });
})();
