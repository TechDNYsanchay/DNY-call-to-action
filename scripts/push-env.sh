#!/usr/bin/env bash
# Pushes the keys shared with Sales QA from this app's .env.local to Vercel Production as Sensitive
# values, through the DNY Vercel login. Only CALLYZER_API_BASE, CALLYZER_API_KEY and DEEPGRAM_API_KEY;
# values travel on stdin only, never on a command line, and are never printed.
#
#   bash scripts/push-env.sh CALLYZER_API_BASE CALLYZER_API_KEY DEEPGRAM_API_KEY
#
# Refuses unless the Vercel CLI is logged in as tech-5297 and .vercel/project.json pins the DNY team's
# dny-call-to-action project. VC_CMD, PROJECT_JSON and ENV_LOCAL override the CLI command, the pin and
# the source file (tests only; VC_CMD is split on spaces).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/env-value.sh

ALLOWED="CALLYZER_API_BASE CALLYZER_API_KEY DEEPGRAM_API_KEY"
DNY_USER="tech-5297"
DNY_TEAM="team_OlIlw1Oi3U81fSrgeQnvcZaq"
PROJECT="dny-call-to-action"
read -r -a VC <<< "${VC_CMD:-bash scripts/vc.sh}"
PROJECT_JSON="${PROJECT_JSON:-.vercel/project.json}"
ENV_LOCAL="${ENV_LOCAL:-.env.local}"

if [ "$#" -eq 0 ]; then
  echo "Name the keys to push: $ALLOWED" >&2
  exit 1
fi
for name in "$@"; do
  case " $ALLOWED " in
    *" $name "*) ;;
    *)
      echo "$name is not one of $ALLOWED; nothing was pushed." >&2
      exit 1
      ;;
  esac
done

who=$("${VC[@]}" whoami 2>/dev/null) || who=""
who="${who//[$'\r\n\t ']/}"
if [ "$who" != "$DNY_USER" ]; then
  echo "The Vercel CLI is not logged in as $DNY_USER (the DNY account); nothing was pushed." >&2
  exit 1
fi
if [ ! -f "$PROJECT_JSON" ] \
  || ! grep -Eq "\"orgId\"[[:space:]]*:[[:space:]]*\"$DNY_TEAM\"" "$PROJECT_JSON" \
  || ! grep -Eq "\"projectName\"[[:space:]]*:[[:space:]]*\"$PROJECT\"" "$PROJECT_JSON"; then
  echo "$PROJECT_JSON does not pin the DNY team's $PROJECT project; nothing was pushed." >&2
  exit 1
fi

# Every value is checked before anything is pushed, so a run never leaves half the keys changed.
for name in "$@"; do
  value=$(env_value "$name" "$ENV_LOCAL")
  if [ -z "$value" ]; then
    echo "$name is missing or empty in .env.local; nothing was pushed." >&2
    exit 1
  fi
done

for name in "$@"; do
  value=$(env_value "$name" "$ENV_LOCAL")
  # A value that is not there yet is fine: rm then reports not found. When rm did remove one, a failed add
  # below leaves the name unset in Production (the calls job then reports not_configured), so say so.
  removed=""
  if "${VC[@]}" env rm "$name" production --yes >/dev/null 2>&1; then removed=1; fi
  err=$(mktemp)
  if ! printf '%s' "$value" | "${VC[@]}" env add "$name" production --sensitive >/dev/null 2>"$err"; then
    if [ -n "$removed" ]; then
      state="$name was removed from Production and not re-added"
    else
      state="$name was not added to Production"
    fi
    if grep -qi "sensitive" "$err"; then
      echo "The Vercel CLI refused --sensitive: $state. Mark $name Sensitive in the Vercel dashboard (add it there for Production), or update the CLI and re-run; the keys after it were not pushed." >&2
    else
      echo "Adding $name to Production failed: $state; fix the cause and re-run. The keys after it were not pushed." >&2
    fi
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
  echo "$name sent to Production (sensitive, ${#value} characters)"
done
echo "Redeploy for the values to apply."
