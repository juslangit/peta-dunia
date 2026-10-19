#!/usr/bin/env node
// Fetch real open data and write it as the map's external JSON (data/world.json).
//
//   node tools/fetch-data.mjs
//
// Sources (both CC BY 4.0, no API key needed):
//   - World Bank, World Development Indicators: population, GDP per capita, life expectancy
//     for every economy, keyed by ISO 3166-1 alpha-3 (the map's country IDs).
//   - Department of Statistics Malaysia via OpenDOSM (data.gov.my, dataset population_state):
//     population of the 16 Malaysian states and federal territories, keyed by ISO 3166-2 (MY-01…MY-16).
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "world.json");
const FIRST_YEAR = 2000;

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// Trim null ends; return { start, values } or null when there is nothing.
function series(byYear, round) {
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  let values = years.map((y) => (byYear[y] == null ? null : round(byYear[y])));
  let start = years[0];
  while (values.length && values[0] == null) { values.shift(); start++; }
  while (values.length && values[values.length - 1] == null) values.pop();
  if (values.filter((v) => v != null).length < 2) return null;
  return { start, values };
}

// ---------------------------------------------------------------- World Bank
const WB_INDICATORS = [
  { id: "SP.POP.TOTL", type: "line", title: "Population", unit: "people", round: (v) => Math.round(v) },
  { id: "NY.GDP.PCAP.CD", type: "bar", title: "GDP per capita", unit: "US$", round: (v) => Math.round(v) },
  { id: "SP.DYN.LE00.IN", type: "line", title: "Life expectancy", unit: "years", round: (v) => Math.round(v * 10) / 10 },
];

async function worldBank() {
  const [, countries] = await getJSON("https://api.worldbank.org/v2/country?format=json&per_page=400");
  const economies = new Set(countries.filter((c) => c.region.value !== "Aggregates").map((c) => c.id));
  const year = new Date().getFullYear();
  const out = {};
  for (const ind of WB_INDICATORS) {
    const url = `https://api.worldbank.org/v2/country/all/indicator/${ind.id}?format=json&per_page=20000&date=${FIRST_YEAR}:${year}`;
    const [meta, rows] = await getJSON(url);
    if (meta.pages > 1) throw new Error(`World Bank ${ind.id} paged; raise per_page`);
    const byCountry = {};
    for (const r of rows) {
      const iso3 = r.countryiso3code;
      if (!iso3 || !economies.has(iso3)) continue;
      (byCountry[iso3] ||= {})[r.date] = r.value;
    }
    for (const [iso3, byYear] of Object.entries(byCountry)) {
      const s = series(byYear, ind.round);
      if (!s) continue;
      (out[iso3] ||= { charts: [] }).charts.push({
        type: ind.type, title: ind.title, unit: ind.unit, source: "wb", ...s,
      });
    }
    console.log(`World Bank ${ind.id}: ${Object.keys(byCountry).length} economies`);
  }
  return out;
}

// ---------------------------------------------------------------- OpenDOSM
const MY_STATES = {
  "Johor": "MY-01", "Kedah": "MY-02", "Kelantan": "MY-03", "Melaka": "MY-04",
  "Negeri Sembilan": "MY-05", "Pahang": "MY-06", "Pulau Pinang": "MY-07", "Perak": "MY-08",
  "Perlis": "MY-09", "Selangor": "MY-10", "Terengganu": "MY-11", "Sabah": "MY-12",
  "Sarawak": "MY-13", "W.P. Kuala Lumpur": "MY-14", "W.P. Labuan": "MY-15", "W.P. Putrajaya": "MY-16",
};
const ETHNICITY = {
  bumi_malay: "Malay", bumi_other: "Other Bumiputera", chinese: "Chinese",
  indian: "Indian", other_citizen: "Other citizens", other_noncitizen: "Non-citizens",
};

async function openDosm() {
  const csv = await getText("https://storage.dosm.gov.my/population/population_state.csv");
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const total = {}; // state -> year -> thousands
  const eth = {};   // state -> year -> ethnicity -> thousands
  for (const line of lines) {
    const f = line.split(",");
    if (f[ix.sex] !== "both" || f[ix.age] !== "overall") continue;
    const state = f[ix.state];
    const year = Number(f[ix.date].slice(0, 4));
    const pop = Number(f[ix.population]);
    if (f[ix.ethnicity] === "overall") (total[state] ||= {})[year] = pop;
    else ((eth[state] ||= {})[year] ||= {})[f[ix.ethnicity]] = pop;
  }
  const out = {};
  const unknown = Object.keys(total).filter((s) => !MY_STATES[s]);
  if (unknown.length) throw new Error(`Unmapped OpenDOSM states: ${unknown.join(", ")}`);
  for (const [state, code] of Object.entries(MY_STATES)) {
    const years = Object.fromEntries(Object.entries(total[state] || {}).filter(([y]) => y >= FIRST_YEAR)
      .map(([y, v]) => [y, v * 1000]));
    const s = series(years, (v) => Math.round(v));
    const charts = [];
    if (s) charts.push({ type: "line", title: "Population", unit: "people", source: "dosm", ...s });
    const lastYear = Math.max(...Object.keys(eth[state] || {}).map(Number));
    const e = eth[state]?.[lastYear];
    if (e) {
      const keys = Object.keys(ETHNICITY).filter((k) => e[k] != null);
      charts.push({
        type: "bar", title: `Population by group, ${lastYear}`, unit: "people", source: "dosm",
        labels: keys.map((k) => ETHNICITY[k]), values: keys.map((k) => Math.round(e[k] * 1000)),
      });
    }
    out[code] = { charts };
  }
  console.log(`OpenDOSM population_state: ${Object.keys(out).length} states`);
  return out;
}

const [wb, dosm] = await Promise.all([worldBank(), openDosm()]);
const today = new Date().toISOString().slice(0, 10);
const data = {
  version: 1,
  generated: today,
  sources: {
    wb: { name: "World Bank, World Development Indicators", short: "World Bank WDI", licence: "CC BY 4.0", url: "https://data.worldbank.org/" },
    dosm: { name: "Department of Statistics Malaysia, OpenDOSM", short: "DOSM (OpenDOSM)", licence: "CC BY 4.0", url: "https://open.dosm.gov.my/data-catalogue/population_state" },
  },
  regions: { ...wb, ...dosm },
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
console.log(`Wrote ${OUT}: ${Object.keys(data.regions).length} regions`);
