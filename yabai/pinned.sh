#!/usr/bin/env bash
# pinned.sh - the one list of apps that always live on a fixed space.
#
# Sourced by yabai/place.sh and skhd/jump.sh so launcher and signal agree on
# where a window belongs. Everything not listed here keeps the default
# behaviour: a first launch opens on the space you are standing on.
#
# Format: <yabai app regex>|<space index>, one per line.

PINNED_APPS='
^Slack$|2
^Spark Desktop$|2
^Spotify$|3
^Discord$|3
'

# pinned_space <app name or app regex>
# Prints the space index and returns 0 when pinned, returns 1 when not.
# Accepts either a live app name ("Spark Desktop") or the exact regex a
# launcher was called with ('^Spark Desktop$').
pinned_space() {
  needle="$1"
  [ -z "$needle" ] && return 1
  while IFS='|' read -r re sp; do
    [ -z "$re" ] && continue
    if [ "$re" = "$needle" ] || printf '%s' "$needle" | grep -Eiq "$re"; then
      printf '%s' "$sp"
      return 0
    fi
  done <<EOF
$PINNED_APPS
EOF
  return 1
}
