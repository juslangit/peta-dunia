# Peta Dunia

*Peta dunia* is Malay for "world map". This is one self-contained SVG of every country and its
4,602 first-level sub-regions (states, provinces, territories). Click any region, or Tab to it and
press Enter, and a small panel opens inside the SVG with a chart drawn from JSON. No libraries.

**Live:** https://peta-dunia.pages.dev · **Acceptance test:** https://peta-dunia.pages.dev/blank.html

It was built as a worked answer to a freelance brief: "a single, self-contained SVG file that renders
an entire world map, broken down by every country and its first-level sub-regions; each shape
individually clickable; a click opens a chart drawn from external JSON; smooth transitions, clear
hover highlighting, crisp vector paths; minimal dependencies; load the SVG in a blank HTML page,
click any region, and a chart appears immediately without console errors."

## What you get

| File | What it is |
|---|---|
| `peta-dunia.svg` | The deliverable: 1.3 MB (417 KB gzipped). Every shape, the styles, the script (23 KB, no dependencies) and the real data, minified. |
| `data/world.json` | Real data, the same block that is embedded in the SVG: World Bank population, GDP per capita and life expectancy for 217 economies, OpenDOSM population for Malaysia's 16 states. |
| `data/sample.json` | The brief's sample: mock data for four regions (Selangor, France, São Paulo, California), marked as mock wherever it shows. |
| `data/regions.csv` | Every ID on the map with its name, country and whether it has data. |
| `blank.html` | The acceptance test: a blank page holding only the SVG. |
| `index.html` | The showcase page. |

## Embed it

```html
<object data="peta-dunia.svg" type="image/svg+xml" style="width:100%;aspect-ratio:2/1">World map</object>
```

`<embed>`, `<iframe>` or pasting the SVG markup inline all work too. The embedded data is used by
default, so it works offline and straight from disk. To chart your own data, either:

- add `?data=your.json` to the SVG's URL (`<object data="peta-dunia.svg?data=/sales.json">`),
- set `data-src="your.json"` on the `<svg>` element (useful when the SVG is inline), or
- call `PetaDunia.load(urlOrObject)` from script.

External JSON is fetched only over http(s); from `file://` the embedded data stays in use, so the
console stays clean.

### JSON format

```json
{
  "sources": { "mine": { "name": "My company", "licence": "internal" } },
  "regions": {
    "MY-10": { "charts": [
      { "type": "line", "title": "Orders", "unit": "orders", "source": "mine",
        "start": 2020, "values": [120, 180, 260, 410] },
      { "type": "bar", "title": "Orders by channel", "unit": "orders",
        "labels": ["Web", "App", "Phone"], "values": [900, 700, 60] }
    ] },
    "FRA": { "charts": [ { "type": "bar", "title": "Visitors", "start": 2019, "values": [42000, 18500] } ] }
  }
}
```

- Keys are map IDs: ISO 3166-1 alpha-3 for countries (`MYS`), ISO 3166-2 for regions (`MY-10`), or
  Natural Earth's `adm1_code` where no unique ISO code exists. `data/regions.csv` lists them all.
- A chart is `line` or `bar`. A time series gives `start` and `values`; categories give `labels` and
  `values` (a categorical bar chart is drawn horizontally). `unit` of `US$`, `$`, `RM`, `€` becomes a
  prefix, `%` a suffix; `prefix`/`suffix` override it.
- A region without its own charts falls back to its country's, labelled as such. Where neither exists
  the panel shows a "no data" chart that names the ID to add.
- `"mock": true` at the top level (or on a source) labels every chart as mock data.

### Script API and events

```js
const map = document.querySelector("object").contentWindow.PetaDunia; // or window.PetaDunia when inline
map.select("MY-10");      // select a region and open its chart
map.zoomTo("MYS", 0.42);  // frame a country or region
map.load("/q3.json");     // swap the data (URL or object)
map.close(); map.reset(); map.regions(); map.data();
```

Every selection fires a `petadunia:select` CustomEvent on the `<svg>` (bubbles), and, when the map
is in a frame, posts `{ type: "petadunia:select", detail: { id, name, countryId, country } }` to the
parent window. Closing fires `petadunia:close`.

### Keyboard

The map is one Tab stop. Arrow keys move to the nearest region in that direction, Page Up / Page
Down jump between countries, Home / End go to the first and last, typing a name jumps to it, Enter
or Space opens the chart, Escape closes it and returns focus, `+` / `-` zoom and `0` resets. Tiny
regions get a locator ring when focused. Motion is switched off under `prefers-reduced-motion`.

## Rebuild

Needs Node 18+, curl, unzip and npx (mapshaper and esbuild are fetched on demand). No API keys.

```bash
./tools/build-geo.sh        # Natural Earth 10m admin-1 + admin-0 -> simplified Equal Earth GeoJSON (build/)
node tools/fetch-data.mjs   # World Bank + OpenDOSM -> data/world.json
node tools/build-svg.mjs    # -> peta-dunia.svg and data/regions.csv
python3 -m http.server 8765 # then open http://localhost:8765
./tools/deploy.sh           # publish to Cloudflare Pages
```

`SIMPLIFY=8%` (default) controls how much detail mapshaper keeps; coordinates are written at 0.1 unit
of a 2000-wide viewBox (about 2 km).

## Sources and licences

- Boundaries: [Natural Earth](https://www.naturalearthdata.com/) 1:10m admin-1 and admin-0, public domain.
  Natural Earth draws boundaries as they are on the ground; disputed areas keep its own codes.
- Country data: [World Bank, World Development Indicators](https://data.worldbank.org/), CC BY 4.0.
- Malaysian state data: [Department of Statistics Malaysia, OpenDOSM `population_state`](https://open.dosm.gov.my/data-catalogue/population_state), CC BY 4.0.
- `data/sample.json` is invented.
- Code: MIT, see `LICENSE`. Page design language follows `DESIGN.md` (Carbon-style tokens, IBM Plex
  Sans under the SIL Open Font License); no IBM branding is used.

Made by [Luqman Hakeem](https://github.com/juslangit).
