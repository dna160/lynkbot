#!/usr/bin/env bash
# Build workspace packages only.
# apps/api and apps/worker are run directly via run-ts.cjs (on-the-fly transpilation).
# DO NOT compile apps/api or apps/worker here — tsc emit hangs on pnpm symlinks.
# See DEPLOYMENT.md for full runbook.
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
for pkg in shared db ai meta payments pantheon; do
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

echo "✓ Workspace packages compiled. Start API with:"
echo "   nohup /tmp/start-api.sh >> /tmp/lynkbot-api.log 2>&1 &"
