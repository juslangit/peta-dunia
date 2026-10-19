#!/usr/bin/env node
// Assemble the deliverable: peta-dunia.svg (every shape with a unique ID, the script, the styles
// and the real data embedded, minified) plus data/regions.csv (every ID with its name).
//
//   ./tools/build-geo.sh && node tools/fetch-data.mjs && node tools/build-svg.mjs
//
// IDs: countries use ISO 3166-1 alpha-3 (Natural Earth's ISO_A3_EH; Kosovo uses the World Bank's
// XKX); disputed or non-ISO units keep Natural Earth's ADM0_A3. Sub-regions use ISO 3166-2 where
// Natural Earth gives one that is unique, otherwise Natural Earth's adm1_code (e.g. "PHL-1234").
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const B = (f) => join(ROOT, "build", f);
const WIDTH = 2000;          // viewBox width
const Q = Number(process.env.Q || 10); // coordinate grid: 10 = one decimal place (0.1 unit is about 2 km)
const read = async (f) => JSON.parse(await readFile(f, "utf8"));

const [regions, borders, sphere, graticule, admin0csv, data] = await Promise.all([
  read(B("regions.json")), read(B("borders.json")), read(B("sphere.json")), read(B("graticule.json")),
  readFile(B("admin0.csv"), "utf8"), read(join(ROOT, "data", "world.json")),
]);

// mapshaper writes attribute-less layers as GeometryCollections; treat both shapes alike.
const geoms = (fc) => (fc.features ? fc.features.map((f) => f.geometry) : fc.geometries);

// ------------------------------------------------------------------ projection to the viewBox
const ring0 = geoms(sphere)[0].coordinates.flat(2);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let i = 0; i < ring0.length; i += 2) {
  minX = Math.min(minX, ring0[i]); maxX = Math.max(maxX, ring0[i]);
  minY = Math.min(minY, ring0[i + 1]); maxY = Math.max(maxY, ring0[i + 1]);
}
const PAD = 4;
const S = (WIDTH - PAD * 2) / (maxX - minX);
const HEIGHT = Math.ceil((maxY - minY) * S + PAD * 2);
const P = (x, y, q) => [Math.round(((x - minX) * S + PAD) * q), Math.round(((maxY - y) * S + PAD) * q)];

// Encode one ring/line as compact relative SVG path data at precision q (1 = integers, 10 = 0.1).
function enc(coords, closed, q) {
  const pts = [];
  for (const [x, y] of coords) {
    const p = P(x, y, q);
    const l = pts[pts.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) pts.push(p);
  }
  if (closed && pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  if (pts.length < (closed ? 3 : 2)) return null;
  const n = (v) => (q === 1 ? String(v) : String(v / q)).replace(/^(-?)0\./, "$1.");
  // Numbers can be glued without a space when the next one starts with "-", or starts with "."
  // and the previous one already has a "." (SVG's number grammar then splits them unambiguously).
  let out = "", last = "";
  const push = (tok) => {
    const glue = !last || tok[0] === "-" || (tok[0] === "." && last.includes("."));
    out += (glue ? "" : " ") + tok;
    last = tok;
  };
  push(n(pts[0][0])); push(n(pts[0][1]));
  const d = "M" + out;
  out = ""; last = "";
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    push(n(pts[i][0] - prev[0])); push(n(pts[i][1] - prev[1]));
    prev = pts[i];
  }
  out = "l" + out;
  return d + out + (closed ? "z" : "");
}

// Bounding box of a geometry in viewBox units.
function bbox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (a) => {
    if (typeof a[0] === "number") { const [x, y] = P(a[0], a[1], 1e3).map((v) => v / 1e3); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    else a.forEach(walk);
  };
  walk(geom.coordinates);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
// Microstates and specks (Vatican, Monaco, small atolls) are smaller than a pixel even at full zoom.
// They get a small round marker added to their own path, so they can still be seen and clicked.
const SPECK = 0.7, DOT = 0.35;
function speck(geom) {
  const b = bbox(geom);
  if (Math.max(b.w, b.h) >= SPECK) return "";
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, r = DOT;
  const f = (v) => String(Math.round(v * 100) / 100).replace(/^(-?)0\./, "$1.");
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0z`;
}

function geomPath(geom, closed, minQ = Q) {
  if (!geom) return "";
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates
    : geom.type === "LineString" ? [[geom.coordinates]] : geom.type === "MultiLineString" ? [geom.coordinates] : [];
  const parts = [];
  for (const poly of polys) for (const ring of poly) { const d = enc(ring, closed, minQ); if (d) parts.push(d); }
  if (!parts.length && closed) {
    // Tiny shape: keep it, with one more decimal so it does not collapse to nothing.
    for (const q of [Q * 10, Q * 100, Q * 1000]) {
      for (const poly of polys) for (const ring of poly) { const d = enc(ring, closed, q); if (d) parts.push(d); }
      if (parts.length) break;
    }
  }
  return parts.join("");
}

// ------------------------------------------------------------------ IDs
const admin0 = {};
{
  const [head, ...rows] = admin0csv.trim().split("\n");
  const cols = head.split(",");
  for (const row of rows) {
    // NAME fields may be quoted and contain commas
    const f = row.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    const r = Object.fromEntries(cols.map((c, i) => [c, f[i]]));
    admin0[r.ADM0_A3] = r;
  }
}
const OVERRIDE = { KOS: "XKX" };
const usedCountry = new Set();
const countryId = {};
const adm0s = [...new Set(regions.features.map((f) => f.properties.adm0_a3))];
// First pass: real ISO codes; second: fall back to ADM0_A3 on conflict.
for (const a3 of adm0s) {
  const eh = OVERRIDE[a3] || admin0[a3]?.ISO_A3_EH;
  if (eh && eh !== "-99" && (eh === a3 || !adm0s.includes(eh))) { countryId[a3] = eh; }
}
for (const a3 of adm0s) {
  if (!countryId[a3]) countryId[a3] = a3;
  if (usedCountry.has(countryId[a3])) countryId[a3] = a3;
  usedCountry.add(countryId[a3]);
}
const isoCount = {};
for (const f of regions.features) {
  const iso = f.properties.iso_3166_2 || "";
  isoCount[iso] = (isoCount[iso] || 0) + 1;
}
const validIso = (s) => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(s);
const usedRegion = new Set(usedCountry);
const countries = {};
let viaIso = 0, viaNe = 0;
for (const f of regions.features) {
  const p = f.properties;
  let id = validIso(p.iso_3166_2) && isoCount[p.iso_3166_2] === 1 ? p.iso_3166_2 : p.adm1_code;
  if (id === p.iso_3166_2) viaIso++; else viaNe++;
  // A few Natural Earth codes carry "+" or "?" (e.g. Somaliland's "SOL+00?"); make them valid XML IDs.
  id = String(id || "").replace(/[^\w.-]+/g, "-").replace(/-+$/, "");
  for (let n = 2; usedRegion.has(id); n++) id = id.replace(/_\d+$/, "") + "_" + n;
  if (!id || usedRegion.has(id) || !/^[A-Za-z][\w.-]*$/.test(id)) throw new Error(`Bad or duplicate region id: ${id}`);
  usedRegion.add(id);
  const cid = countryId[p.adm0_a3];
  const cname = admin0[p.adm0_a3]?.NAME_LONG || p.admin;
  (countries[cid] ||= { id: cid, name: cname, regions: [] }).regions.push({ id, name: p.name || cname, f });
}

// ------------------------------------------------------------------ data: keep regions that exist
const known = new Set([...usedRegion]);
const kept = {}, dropped = [];
for (const [id, v] of Object.entries(data.regions)) (known.has(id) ? (kept[id] = v) : dropped.push(id));
const embedded = { ...data, regions: kept };
const noData = Object.keys(countries).filter((c) => !kept[c]);

// ------------------------------------------------------------------ assemble
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const collator = new Intl.Collator("en");
const sortedCountries = Object.values(countries).sort((a, b) => collator.compare(a.name, b.name));
let mapG = "";
const csv = ["id,name,country_id,country_name,has_data"];
let shapes = 0, specks = 0, empty = [];
for (const c of sortedCountries) {
  c.regions.sort((a, b) => collator.compare(a.name, b.name));
  mapG += `<g id="${c.id}" role="group" aria-label="${esc(c.name)}">`;
  for (const r of c.regions) {
    const dot = speck(r.f.geometry);
    if (dot) specks++;
    const d = geomPath(r.f.geometry, true) + dot;
    if (!d) { empty.push(r.id); continue; }
    mapG += `<path id="${r.id}" aria-label="${esc(r.name)}" d="${d}"/>`;
    shapes++;
    csv.push([r.id, r.name, c.id, c.name, kept[r.id] ? "region" : kept[c.id] ? "country" : "none"]
      .map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","));
  }
  mapG += "</g>";
}
if (empty.length) throw new Error(`Shapes lost in encoding: ${empty.join(", ")}`);
const bordersD = geoms(borders).map((g) => geomPath(g, false)).join("");
const sphereD = geomPath(geoms(sphere)[0], true, 1);
const gratD = geoms(graticule).map((g) => geomPath(g, false, 1)).join("");

function minify(file, loader) {
  return execFileSync("npx", ["--yes", "esbuild@0.24.0", file, "--minify", "--target=es2019,chrome90,safari14,firefox90", "--legal-comments=none"],
    { encoding: "utf8" }).trim();
}
const css = minify(join(ROOT, "src", "map.css"), "css");
const js = minify(join(ROOT, "src", "map.js"), "js");
const json = JSON.stringify(embedded);
for (const [name, s] of [["css", css], ["js", js], ["json", json]]) if (s.includes("]]>")) throw new Error(`${name} contains ]]>`);

const title = "Peta Dunia: interactive world map of countries and their first-level sub-regions";
const desc = "Every country and its states, provinces and territories, each clickable. Select a region to open a chart. " +
  "Keyboard: Tab to the map, arrow keys move between neighbouring regions, Page Up and Page Down jump between countries, " +
  "type a name to find it, Enter or Space opens its chart, Escape closes it, plus and minus zoom, 0 resets.";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="peta-dunia" class="pd" viewBox="0 0 ${WIDTH} ${HEIGHT}" ` +
  `role="group" aria-roledescription="interactive map" aria-labelledby="pd-title" aria-describedby="pd-desc">` +
  `<title id="pd-title">${esc(title)}</title><desc id="pd-desc">${esc(desc)}</desc>` +
  `<style><![CDATA[${css}]]></style>` +
  `<g id="pd-viewport"><path class="pd-sea" d="${sphereD}"/><path class="pd-grat" d="${gratD}"/>` +
  `<g id="pd-map">${mapG}</g>` +
  `<path class="pd-borders" d="${bordersD}"/>` +
  `<path id="pd-hl-sel" class="pd-hl"/><path id="pd-hl-focus" class="pd-hl"/><path id="pd-hl-focus-in" class="pd-hl"/></g>` +
  `<g id="pd-ui"/>` +
  `<script type="application/json" id="pd-data"><![CDATA[${json}]]></script>` +
  `<script><![CDATA[${js}]]></script></svg>\n`;

await writeFile(join(ROOT, "peta-dunia.svg"), svg);
await writeFile(join(ROOT, "data", "regions.csv"), csv.join("\n") + "\n");

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`peta-dunia.svg: ${kb(svg.length)} (gzip ${kb(gzipSync(svg).length)}), viewBox 0 0 ${WIDTH} ${HEIGHT}`);
console.log(`  countries: ${sortedCountries.length}, sub-region shapes: ${shapes} (ISO 3166-2: ${viaIso}, Natural Earth adm1_code: ${viaNe}; ${specks} specks with a marker)`);
console.log(`  paths ${kb(mapG.length)}, borders ${kb(bordersD.length)}, sphere+graticule ${kb(sphereD.length + gratD.length)}, data ${kb(json.length)}, js ${kb(js.length)}, css ${kb(css.length)}`);
console.log(`  data regions embedded: ${Object.keys(kept).length}; not on the map: ${dropped.join(", ") || "none"}`);
console.log(`  countries without data: ${noData.length} (${noData.slice(0, 40).join(" ")}${noData.length > 40 ? " …" : ""})`);
