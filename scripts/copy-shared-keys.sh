#!/usr/bin/env bash
# Copies the three keys this app shares with Sales QA (the same company accounts) into this app's
# .env.local, without showing them: CALLYZER_API_BASE and CALLYZER_API_KEY (always as a pair) and
# DEEPGRAM_API_KEY. No other name is ever copied. Re-run it after a `vercel env pull`, which blanks
# Sensitive values locally.
#
#   bash scripts/copy-shared-keys.sh                     # from ~/Documents/DNY Sales Agent/.env.local
#   bash scripts/copy-shared-keys.sh /path/to/.env.local
#
# Never press "Generate API Access Key" in Callyzer: it would break Sales QA. ENV_LOCAL overrides the
# destination (tests only).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/env-value.sh

SOURCE="${1:-$HOME/Documents/DNY Sales Agent/.env.local}"
DEST="${ENV_LOCAL:-$PWD/.env.local}"
ALLOWED_HOSTS="sandbox.api.callyzer.co api1.callyzer.co"

if [ ! -f "$SOURCE" ]; then
  echo "No file at $SOURCE; nothing was copied." >&2
  exit 1
fi
if [ "$(resolved_path "$SOURCE")" = "$(resolved_path "$DEST")" ]; then
  echo "The source is this app's own .env.local; give Sales QA's .env.local instead. Nothing was copied." >&2
  exit 1
fi

base=$(env_value CALLYZER_API_BASE "$SOURCE")
key=$(env_value CALLYZER_API_KEY "$SOURCE")
deepgram=$(env_value DEEPGRAM_API_KEY "$SOURCE")

# The Callyzer base and key belong together: one without the other would point a key at the wrong host.
if [ -n "$base" ] && [ -z "$key" ]; then
  echo "CALLYZER_API_KEY is missing or empty in the source, so CALLYZER_API_BASE was not copied either (they go together)."
  base=""
elif [ -z "$base" ] && [ -n "$key" ]; then
  echo "CALLYZER_API_BASE is missing or empty in the source, so CALLYZER_API_KEY was not copied either (they go together)."
  key=""
fi

touch "$DEST"
chmod 600 "$DEST"
copied=0

# save NAME (the value is read from the variable named by $2, so it is never an argument of a program)
save() {
  local name="$1" value="${!2}" tmp
  if [ -z "$value" ]; then
    echo "$name is missing or empty in the source; not copied"
    return 0
  fi
  tmp=$(mktemp "$(dirname "$DEST")/.env.local.XXXXXX")
  chmod 600 "$tmp"
  grep -v "^$name=" "$DEST" > "$tmp" || true
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
  mv "$tmp" "$DEST"
  chmod 600 "$DEST"
  echo "$name saved (${#value} characters)"
  copied=$((copied + 1))
}

save CALLYZER_API_BASE base
save CALLYZER_API_KEY key
save DEEPGRAM_API_KEY deepgram

# The base's host only (not a secret), checked against the hosts the calls job accepts.
if [ -n "$base" ]; then
  host="${base#*://}"
  host="${host%%/*}"
  host="${host##*@}"
  verdict="NOT allowed: the calls job will refuse it (allowed: $ALLOWED_HOSTS)"
  for allowed in $ALLOWED_HOSTS; do
    if [ "$base" = "https://$allowed" ] || [ "$base" = "https://$allowed/" ]; then verdict="allowed"; fi
  done
  echo "CALLYZER_API_BASE host: $host ($verdict)"
fi
[ "$copied" -gt 0 ] || exit 1
