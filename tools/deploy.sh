#!/usr/bin/env bash
# Put Peta Dunia live on Cloudflare Pages (https://peta-dunia.pages.dev).
#
#   ./tools/deploy.sh
#
# Uses the Cloudflare login already stored by wrangler (`npx wrangler login` if it expires).
# Only the website is uploaded: the page, the SVG, data/, img/, css/, js/. Build scripts, sources,
# notes, the Natural Earth cache and test output stay on this Mac.
set -euo pipefail

PROJECT="peta-dunia"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CLOUDFLARE_ACCOUNT_ID="863c8569b09cb26bbcb75f90f23a26e5"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"
rsync -a --exclude '.git' --exclude 'tools' --exclude 'docs' --exclude 'build' --exclude 'src' \
      --exclude '.taste-skill' --exclude '.impeccable' --exclude '.playwright-cli' --exclude '.DS_Store' \
      --exclude '.gitignore' --exclude 'README.md' --exclude 'DESIGN.md' --exclude 'LICENSE' \
      ./ "$STAGE/"

cd "$STAGE"
if ! npx --yes wrangler@latest pages project list 2>/dev/null | grep -qw "$PROJECT"; then
  npx --yes wrangler@latest pages project create "$PROJECT" --production-branch main --force
fi
echo "Uploading $(du -sh "$STAGE" | cut -f1)…"
npx --yes wrangler@latest pages deploy "$STAGE" --project-name "$PROJECT" --branch main --commit-dirty=true
