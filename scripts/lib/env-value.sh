# Reads one value from a dotenv file without sourcing it (a sourced file could run code) and without
# putting the value on any command line. Sourced by scripts/copy-shared-keys.sh and scripts/push-env.sh;
# it holds functions only, never values.
#
#   v=$(env_value DEEPGRAM_API_KEY .env.local)   # keep it in a variable; never echo it

# The value of the last NAME= line: the text after the first "=", carriage returns removed, and one pair
# of surrounding double or single quotes removed. Prints nothing when the name is absent.
env_value() {
  local name="$1" file="$2" line value
  [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  [ -f "$file" ] || return 0
  line=$(grep -E "^${name}=" "$file" | tail -n1) || true
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="${value//$'\r'/}"
  if [[ ${#value} -ge 2 && "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

# The file's absolute path with symlinks resolved, also for a file that does not exist yet.
resolved_path() {
  local p="$1"
  if command -v readlink >/dev/null 2>&1 && readlink -f -- "$p" >/dev/null 2>&1; then
    readlink -f -- "$p"
  else
    (cd "$(dirname -- "$p")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename -- "$p")")
  fi
}
