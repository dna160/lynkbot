#!/usr/bin/env bash
# Rebuild the API bundle (apps/api/dist/bundle.js) with esbuild.
# IMPORTANT: each @lynkbot/* workspace package exposes "main": "./dist/index.js"
# so esbuild picks up its COMPILED output, not its src/. We must recompile every
# package whose source has changed before re-bundling, or edits won't take effect.
#
# Strategy: for each @lynkbot/<pkg>, recompile if any src/**/*.ts is newer than
# the corresponding dist file. Then re-run esbuild on apps/api.
set -euo pipefail

ROOT="/Users/storytellers/Documents/Claude Home/Lynkbot"
cd "$ROOT" || exit 1

ESBUILD_LIB="$ROOT/node_modules/.pnpm/esbuild@0.28.0/node_modules/esbuild/lib/main.js"
if [ ! -f "$ESBUILD_LIB" ]; then
  echo "ERROR: esbuild not found at $ESBUILD_LIB" >&2
  exit 1
fi

# --- Recompile workspace packages whose src is newer than dist ---
# Order matters: shared has no internal deps; others depend on shared.
for pkg in shared db ai wati payments; do
  PKG_DIR="$ROOT/packages/$pkg"
  [ -d "$PKG_DIR/src" ] || continue
  NEWEST_SRC=$(find "$PKG_DIR/src" -name '*.ts' -type f -exec stat -f '%m' {} \; | sort -n | tail -1)
  NEWEST_DIST=$(find "$PKG_DIR/dist" -name '*.js' -type f -exec stat -f '%m' {} \; 2>/dev/null | sort -n | tail -1)
  NEWEST_DIST=${NEWEST_DIST:-0}
  if [ "${NEWEST_SRC:-0}" -gt "$NEWEST_DIST" ]; then
    echo "→ recompiling @lynkbot/$pkg (src newer than dist)"
    TSC="$PKG_DIR/node_modules/.bin/tsc"
    [ -x "$TSC" ] || TSC="$ROOT/node_modules/.bin/tsc"
    [ -x "$TSC" ] || TSC="$ROOT/apps/api/node_modules/.bin/tsc"
    if [ ! -x "$TSC" ]; then
      echo "ERROR: tsc not found for $pkg" >&2
      exit 1
    fi
    (cd "$PKG_DIR" && "$TSC")
  else
    echo "  @lynkbot/$pkg dist up-to-date — skipping tsc"
  fi
done

# --- Re-bundle apps/api ---
START=$(date +%s)
node --input-type=module -e "
import { build } from '$ESBUILD_LIB';
await build({
  entryPoints: ['apps/api/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'apps/api/dist/bundle.js',
  external: [
    'pg-native', 'better-sqlite3', 'mysql2', 'oracledb',
    'tedious', '@aws-sdk/client-s3', '@aws-sdk/lib-storage', 'canvas',
  ],
  loader: { '.node': 'file' },
  logLevel: 'info',
});
console.log('BUILD_OK');
"
ELAPSED=$(( $(date +%s) - START ))
SIZE=$(stat -f%z apps/api/dist/bundle.js 2>/dev/null || stat -c%s apps/api/dist/bundle.js)
echo "Bundle: apps/api/dist/bundle.js ($SIZE bytes, ${ELAPSED}s)"
