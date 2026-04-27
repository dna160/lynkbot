#!/usr/bin/env bash
# Rebuild apps/api using tsc --noCheck (transpile only, no type checking).
# --noCheck (TypeScript 5.5+) skips type analysis — fast like esbuild but uses the TS compiler.
# Compiles @lynkbot/* workspace packages first, then apps/api.
# Output: apps/api/dist/  (CommonJS, mirrors src/ structure)
# Run with: node apps/api/dist/index.js
set -euo pipefail

ROOT="/Users/storytellers/Documents/Claude Home/Lynkbot"
cd "$ROOT" || exit 1

find_tsc() {
  local pkg_dir="$1"
  for t in "$pkg_dir/node_modules/.bin/tsc" "$ROOT/node_modules/.bin/tsc" "$ROOT/apps/api/node_modules/.bin/tsc"; do
    [ -x "$t" ] && echo "$t" && return
  done
  echo "ERROR: tsc not found for $pkg_dir" >&2; exit 1
}

# --- Recompile workspace packages whose src is newer than dist ---
for pkg in shared db ai wati payments pantheon; do
  PKG_DIR="$ROOT/packages/$pkg"
  [ -d "$PKG_DIR/src" ] || continue
  NEWEST_SRC=$(find "$PKG_DIR/src" -name '*.ts' -type f -exec stat -f '%m' {} \; | sort -n | tail -1)
  NEWEST_DIST=$(find "$PKG_DIR/dist" -name '*.js' -type f -exec stat -f '%m' {} \; 2>/dev/null | sort -n | tail -1)
  NEWEST_DIST=${NEWEST_DIST:-0}
  if [ "${NEWEST_SRC:-0}" -gt "$NEWEST_DIST" ]; then
    echo "→ recompiling @lynkbot/$pkg"
    TSC=$(find_tsc "$PKG_DIR")
    (cd "$PKG_DIR" && "$TSC")
  else
    echo "  @lynkbot/$pkg dist up-to-date"
  fi
done

# --- Compile apps/api with --noCheck (transpile-only, no type analysis) ---
echo "→ compiling apps/api (--noCheck)"
TSC=$(find_tsc "$ROOT/apps/api")
(cd "$ROOT/apps/api" && "$TSC" --noCheck)

SIZE=$(du -sh "$ROOT/apps/api/dist" 2>/dev/null | cut -f1)
echo "✓ apps/api/dist ready ($SIZE). Run: node apps/api/dist/index.js"
