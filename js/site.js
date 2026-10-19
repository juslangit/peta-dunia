/* Peta Dunia showcase page. The map itself is peta-dunia.svg inside the iframe; this file only wires
   the page around it (data switch, click read-out, the bar chart, slider, file sheets, tabs, FAQ). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ------------------------------------------------------------------ the map
  var frame = $("#map-frame");
  var lastClick = $("#last-click");
  function api() {
    try { return frame.contentWindow && frame.contentWindow.PetaDunia; } catch (e) { return null; }
  }
  function whenReady(fn) {
    if (api()) return fn(api());
    frame.addEventListener("load", function once() { frame.removeEventListener("load", once); if (api()) fn(api()); });
  }
  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "petadunia:select") {
      var d = e.data.detail || {};
      lastClick.textContent = (d.name && d.name !== d.country ? d.name + ", " + d.country : d.country || d.id) + " · " + d.id;
    }
  });

  // Real data or the brief's mock sample, loaded into the running map.
  $$(".switch").forEach(function (b) {
    b.addEventListener("click", function () {
      $$(".switch").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
      whenReady(function (map) {
        map.load(b.getAttribute("data-src")).catch(function () { /* keep the current data */ });
      });
    });
  });

  function openOnMap(id, zoomCountry) {
    var top = $("#map").getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce.matches ? "auto" : "smooth" });
    whenReady(function (map) {
      if (zoomCountry) map.zoomTo(zoomCountry, 0.42);
      window.setTimeout(function () { map.select(id); }, reduce.matches ? 0 : 380);
    });
  }

  // ------------------------------------------------------------------ bars
  var bars = $(".bars");
  $$(".bars li").forEach(function (li, i) {
    li.style.setProperty("--n", i);
    var b = $("button", li);
    var name = $(".bars__name", li).textContent, val = $(".bars__val", li).textContent;
    b.setAttribute("aria-label", name + ": " + val + " people in 2026. Open on the map");
    b.addEventListener("click", function () { openOnMap(b.getAttribute("data-region"), "MYS"); });
  });

  $$("[data-sample]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      $('.switch[data-src="data/sample.json"]').click();
      openOnMap("US-CA");
    });
  });

  // ------------------------------------------------------------------ zoom story (pinned picture)
  var shots = $$(".zoom__pics img");
  var steps = $$(".zoom__step");
  if ("IntersectionObserver" in window) {
    var stepObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var n = Number(en.target.getAttribute("data-shot"));
        steps.forEach(function (s) { s.classList.toggle("is-on", s === en.target); });
        shots.forEach(function (img, k) { img.classList.toggle("is-on", k === n); });
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    steps.forEach(function (s) { stepObs.observe(s); });
  }

  // ------------------------------------------------------------------ embed slider
  var range = $("#step-range");
  var clause = $("#step-clause");
  var codes = $$("#step-code pre");
  var names = $$(".steps__names li");
  var track = $(".steps__track");
  var CLAUSES = [
    "First, put the file on a page.",
    "Then point it at your JSON.",
    "Next, hear every click on the map.",
    "Finally, drive it from your own code."
  ];
  function setStep(n) {
    clause.style.opacity = 0;
    window.setTimeout(function () { clause.textContent = CLAUSES[n]; clause.style.opacity = 1; }, reduce.matches ? 0 : 120);
    codes.forEach(function (c, k) { c.classList.toggle("is-on", k === n); });
    names.forEach(function (l, k) { l.classList.toggle("is-on", k === n); });
    range.setAttribute("aria-valuetext", names[n].textContent);
    track.style.setProperty("--fill", "calc(16px + " + (n / 3) + " * (100% - 32px))");
  }
  range.addEventListener("input", function () { setStep(Number(range.value)); });
  $$(".steps__names button").forEach(function (b) {
    b.addEventListener("click", function () { range.value = b.getAttribute("data-step"); setStep(Number(range.value)); });
  });
  setStep(0);

  // ------------------------------------------------------------------ files
  var fileBtns = $$(".files__name");
  var sheets = $$(".sheet");
  fileBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      var n = b.getAttribute("data-file");
      fileBtns.forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
      sheets.forEach(function (s) { s.classList.toggle("is-on", s.getAttribute("data-file") === n); });
    });
  });

  // ------------------------------------------------------------------ sources tabs
  var tabs = $$(".tab");
  var panes = $$(".bands");
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      var n = t.getAttribute("data-src-tab");
      tabs.forEach(function (o) { o.setAttribute("aria-pressed", o === t ? "true" : "false"); });
      panes.forEach(function (p) { p.classList.toggle("is-on", p.getAttribute("data-src-pane") === n); });
    });
  });

  // ------------------------------------------------------------------ FAQ: hover, focus or click selects
  var qs = $$(".faq__q");
  var pane = $("#faq-pane");
  var wide = window.matchMedia("(min-width: 761px)");
  function pick(q, toggle) {
    var open = toggle && !wide.matches ? q.getAttribute("aria-expanded") !== "true" : true;
    qs.forEach(function (o) { o.setAttribute("aria-expanded", o === q && open ? "true" : "false"); });
    var a = document.getElementById(q.getAttribute("aria-controls"));
    if (wide.matches && pane.textContent !== a.textContent) {
      pane.style.opacity = 0;
      window.setTimeout(function () { pane.innerHTML = a.innerHTML.replace(/^\s*<p>|<\/p>\s*$/g, ""); pane.style.opacity = 1; }, reduce.matches ? 0 : 120);
    }
  }
  qs.forEach(function (q) {
    q.addEventListener("click", function () { pick(q, true); });
    q.addEventListener("focus", function () { if (wide.matches) pick(q); });
  });

  // ------------------------------------------------------------------ nav: mark the section in view
  var links = $$(".nav__links a");
  if ("IntersectionObserver" in window) {
    var navObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (l) { l.classList.toggle("is-here", l.getAttribute("href") === "#" + en.target.id); });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    links.forEach(function (l) { var s = document.querySelector(l.getAttribute("href")); if (s) navObs.observe(s); });
  }

  // ------------------------------------------------------------------ entrances
  var reveal = $$("[data-reveal]").concat(bars ? [bars] : []);
  if ("IntersectionObserver" in window) {
    var revObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); revObs.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    reveal.forEach(function (el) { revObs.observe(el); });
  } else {
    reveal.forEach(function (el) { el.classList.add("is-in"); });
  }
})();
