#!/usr/bin/env bash
# Prints the total CPU load (user + sys, rounded, no % sign) of a remote Mac.
# Prints nothing if the host is unreachable, so the widget can show "--".
#
# Override the host with: REMOTE_CPU_HOST=some-host ./remote_cpu.sh

set -uo pipefail

HOST="${REMOTE_CPU_HOST:-josh-mac-mini}"
SOCKET="/tmp/sketchybar-remote-cpu-%r@%h:%p"

line=$(
  /usr/bin/ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=4 \
    -o StrictHostKeyChecking=accept-new \
    -o ControlMaster=auto \
    -o ControlPath="$SOCKET" \
    -o ControlPersist=600 \
    "$HOST" \
    'top -l 2 -n 0 -s 1 | grep "CPU usage" | tail -1' 2>/dev/null
)

[ -z "$line" ] && exit 0

echo "$line" | awk '{ gsub(/%/, ""); v = $3 + $5; if (v < 0) v = 0; if (v > 100) v = 100; printf "%.0f", v }'
