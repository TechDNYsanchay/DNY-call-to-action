#!/usr/bin/env bash
# Vercel CLI for THIS project only: uses the DNY login kept in ~/.config/vercel-dny, so the machine's
# global Vercel login (a personal account used by other projects) is never touched.
#
#   bash scripts/vc.sh whoami
#   bash scripts/vc.sh env ls
#   bash scripts/vc.sh deploy --prod
set -euo pipefail
CONFIG_DIR="${VERCEL_DNY_CONFIG:-$HOME/.config/vercel-dny}"
if [ ! -f "$CONFIG_DIR/auth.json" ]; then
  echo "No DNY Vercel login in $CONFIG_DIR. Run: vercel --global-config $CONFIG_DIR login" >&2
  exit 1
fi
exec vercel --global-config "$CONFIG_DIR" "$@"
