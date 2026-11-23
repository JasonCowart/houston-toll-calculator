#!/usr/bin/env bash
# Builds a zip of the Toll Calculator for HCTRA's own web servers.
#
#   packaging/package.sh            # package the current checkout
#   packaging/package.sh main       # package a branch or commit (main = the live site)
#
# The zip holds:
#   site/            the website: copy this folder to the web server
#   update/          fetch_fuel.py, to refresh gas prices weekly (optional)
#   INSTALL.md       how to install it, add the keys and check it
#
# Same build as the GitHub Pages deploy (tests, cache-busting, service worker version), but
# config.js is left with blank keys: HCTRA adds its own on the server. No keys are ever in
# the package.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="${1:-HEAD}"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
SHA="$(git rev-parse --short "$REF")"
DATE="$(date -u +%Y-%m-%d)"
NAME="toll-calculator-$DATE-$SHA"

# 1. A clean copy of that version (committed files only, nothing from the working folder).
mkdir -p "$WORK/src"
git archive "$REF" | tar -x -C "$WORK/src"
cd "$WORK/src"

# 2. The same checks the deploy runs.
node tools/test_tolls.js >/dev/null
node tools/test_rates.js >/dev/null
node tools/test_trips.js >/dev/null

# 3. The website files only.
SITE="$WORK/$NAME/site"
mkdir -p "$SITE"
cp -R index.html sw.js manifest.webmanifest assets css data js "$SITE/"
cat > "$SITE/config.js" <<'JS'
// Settings for the Toll Calculator. Fill these in on the server (see INSTALL.md).
window.TOLL_CONFIG = {
  arcgisApiKey: "",      // required: HCTRA's ArcGIS location services key (referrer-limited to this site)
  // reportEmail: "",    // optional: inbox for "Report a wrong toll" (shown publicly)
  // goatcounter: "",    // optional: GoatCounter site code for anonymous usage counts
};
JS
cp "$ROOT/packaging/web.config" "$SITE/web.config"

# 4. Cache-busting and the service worker version, as in the deploy.
V="$SHA"
sed -i -E "s#(src|href)=\"(config\.js|js/[a-z0-9-]+\.js|css/[a-z0-9-]+\.css)\"#\1=\"\2?v=$V\"#g" "$SITE/index.html"
grep -q "v=$V" "$SITE/index.html"
sed -i "s/^var VERSION = \"dev\";/var VERSION = \"$V\";/" "$SITE/sw.js"
grep -q "VERSION = \"$V\"" "$SITE/sw.js"

# 5. The weekly gas price update and the install notes.
mkdir -p "$WORK/$NAME/update"
cp "$ROOT/tools/fetch_fuel.py" "$WORK/$NAME/update/"   # the current updater (takes --out)
sed -e "s/{{VERSION}}/$SHA/" -e "s/{{DATE}}/$DATE/" "$ROOT/packaging/INSTALL.md" > "$WORK/$NAME/INSTALL.md"

# 6. Zip it.
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$NAME.zip"
(cd "$WORK" && zip -qr "$OUT_DIR/$NAME.zip" "$NAME")
echo "$OUT_DIR/$NAME.zip"
