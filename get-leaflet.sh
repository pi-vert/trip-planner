#!/usr/bin/env bash
set -e
mkdir -p src/vendor/leaflet/images
base="https://unpkg.com/leaflet@1.9.4/dist"
curl -Lf "$base/leaflet.js"  -o "src/vendor/leaflet/leaflet.js"
curl -Lf "$base/leaflet.css" -o "src/vendor/leaflet/leaflet.css"
for f in marker-icon.png marker-icon-2x.png marker-shadow.png layers.png layers-2x.png; do
  curl -Lf "$base/images/$f" -o "src/vendor/leaflet/images/$f"
done
echo "OK: Leaflet installé dans src/vendor/leaflet/"

