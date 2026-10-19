#!/usr/bin/env bash
# Download Natural Earth (public domain) and turn it into one simplified, projected
# GeoJSON of every first-level sub-region in the world, plus a mesh of country borders.
#
#   ./tools/build-geo.sh            # writes build/regions.json and build/borders.json
#
# Natural Earth 10m admin-1 has 4,596 states/provinces. Seven tiny admin-0 units have no
# admin-1 record (Bir Tawil, the Cyprus buffer zone, a few reefs), so they are merged in
# from admin-0 as single-shape regions. Needs curl, unzip and npx (mapshaper is fetched).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/build/ne"
OUT="$ROOT/build"
SIMPLIFY="${SIMPLIFY:-8%}"      # share of removable vertices kept (Visvalingam, weighted)
MAPSHAPER="npx --yes mapshaper@0.6"

mkdir -p "$CACHE"
cd "$CACHE"
for f in ne_10m_admin_1_states_provinces ne_10m_admin_0_countries; do
  if [ ! -f "$f.shp" ]; then
    echo "Downloading $f…"
    curl -sSLO "https://naciscdn.org/naturalearth/10m/cultural/$f.zip"
    unzip -oq "$f.zip" && rm "$f.zip"
  fi
done

# Equal Earth projection; simplification keeps every shape (no island is dropped).
$MAPSHAPER -i ne_10m_admin_1_states_provinces.shp ne_10m_admin_0_countries.shp combine-files snap \
  -rename-layers a1,a0 \
  -filter target=a0 '["BRI","CNM","SPI","BRT","BJN","SER","SCR"].indexOf(ADM0_A3) > -1' \
  -each target=a0 'adm0_a3=ADM0_A3, adm1_code=ADM0_A3+"-ALL", iso_3166_2="", name=NAME_LONG, admin=NAME_LONG, type_en="Territory"' \
  -filter-fields target=a1 adm0_a3,adm1_code,iso_3166_2,name,admin,type_en \
  -filter-fields target=a0 adm0_a3,adm1_code,iso_3166_2,name,admin,type_en \
  -merge-layers target=a1,a0 force name=regions \
  -clean \
  -simplify weighted "$SIMPLIFY" keep-shapes \
  -proj +proj=eqearth \
  -dissolve adm0_a3 + name=countries \
  -innerlines target=countries + name=borders \
  -graticule polygon name=sphere \
  -graticule interval=30 name=graticule \
  -o target=regions "$OUT/regions.json" format=geojson precision=0.001 \
  -o target=borders "$OUT/borders.json" format=geojson precision=0.001 \
  -o target=sphere "$OUT/sphere.json" format=geojson precision=0.001 \
  -o target=graticule "$OUT/graticule.json" format=geojson precision=0.001

# Country names and ISO codes from admin-0 (attributes only).
$MAPSHAPER -i ne_10m_admin_0_countries.shp \
  -filter-fields ADM0_A3,ISO_A3_EH,NAME,NAME_LONG,ISO_A2_EH \
  -o "$OUT/admin0.csv"
echo "Done: $(du -h "$OUT/regions.json" | cut -f1) regions, $(du -h "$OUT/borders.json" | cut -f1) borders"
