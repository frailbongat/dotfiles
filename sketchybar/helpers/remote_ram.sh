#!/usr/bin/env bash

set -uo pipefail

HOST="${REMOTE_RAM_HOST:-frail_dev@joshs-mac-mini}"
SOCKET="/tmp/sketchybar-remote-ram-%r@%h:%p"
MAX_SECONDS=8

exec </dev/null 2>/dev/null

output=$(mktemp /tmp/sketchybar-remote-ram.XXXXXX) || exit 0
trap 'rm -f "$output"' EXIT

/usr/bin/ssh \
  -i "$HOME/.ssh/fraildev_newmac" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=4 \
  -o ServerAliveInterval=3 \
  -o ServerAliveCountMax=2 \
  -o StrictHostKeyChecking=accept-new \
  -o ControlMaster=auto \
  -o ControlPath="$SOCKET" \
  -o ControlPersist=600 \
  "$HOST" \
  'memory_pressure -Q | tail -1' >"$output" &
ssh_pid=$!

# ConnectTimeout does not bound a hung ControlMaster, and macOS has no timeout command.
(
  sleep "$MAX_SECONDS" &
  sleep_pid=$!
  trap 'kill "$sleep_pid"; exit 0' TERM
  wait "$sleep_pid"
  kill -KILL "$ssh_pid"
) >/dev/null &
watchdog_pid=$!

wait "$ssh_pid"
kill "$watchdog_pid"

line=$(<"$output")
if [[ "$line" =~ ^System-wide\ memory\ free\ percentage:\ ([0-9]{1,3})%$ ]]; then
  free=$((10#${BASH_REMATCH[1]}))
  [ "$free" -le 100 ] && echo $((100 - free))
fi

exit 0
