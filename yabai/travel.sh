#!/usr/bin/env bash
# travel.sh <pid>   (wired to yabai's application_activated signal)
#
# Replaces the macOS "switch to a Space with open windows for the app"
# behaviour, which we turn off via the workspaces-auto-swoosh Dock default.
# macOS applied that to apps with zero windows too, which is why a closed-but-
# running app reopened on its old space instead of the one you were looking at.
#
# With the Dock default off, macOS never moves you, so this script decides:
#
#   app has a window on your space  -> nothing, you can already see it
#   app has a window elsewhere      -> focus it, you travel to that space
#   app has no window at all        -> write down where you are, and let
#                                      place.sh drag the new window here
#
# The third case needs place.sh because macOS remembers a space per running
# app, not per window. An app whose last window you closed is still "on" its
# old space and reopens there, so the window has to be moved after it appears.
#
# Works no matter how the app was activated: Raycast, Dock, cmd-tab, skhd.
#
# Debug: touch /tmp/yabai-debug, then tail -f /tmp/travel.log
#        rm /tmp/yabai-debug to stop. A file, not an env var, because yabai
#        signals run in a bare shell you cannot export into.

set -u

YABAI=/opt/homebrew/bin/yabai
JQ=/opt/homebrew/bin/jq
LOG=/tmp/travel.log
PENDING=/tmp/yabai-pending-launch
CLAIM=/tmp/yabai-placing

# Apps with a fixed home space. See pinned.sh.
. "$HOME/.config/yabai/pinned.sh"

# Apps that manage their own windows badly enough that yanking focus is worse
# than doing nothing. Add to taste.
IGNORE='^(Raycast|Alfred|Finder|loginwindow|Spotlight|Notification Centre|Notification Center|Control Centre|Control Center)$'

pid="${1:-${YABAI_PROCESS_ID:-}}"
[ -z "$pid" ] && exit 0

app=$(ps -p "$pid" -o comm= 2>/dev/null | sed 's|.*/||')

# Milliseconds matter here: the whole bug is about which signal wins a race.
# bash 3.2 ships with macOS and has no EPOCHREALTIME, hence perl.
now() { perl -MTime::HiRes -e 'my $t=Time::HiRes::time; my @l=localtime $t; printf "%02d:%02d:%02d.%03d", $l[2], $l[1], $l[0], ($t-int $t)*1000'; }
log() { { [ -f /tmp/yabai-debug ] || [ "${TRAVEL_DEBUG:-0}" = "1" ]; } && echo "$(now) travel ${app:-?}($pid) $*" >>"$LOG"; return 0; }

# macOS fires window_created before application_activated when reopening an app
# that is still running with no windows. So place.sh may be mid-move right now.
# Reading the window's space during that would send you to the space it is
# being moved away from, which is the exact bug this pair exists to fix.
if [ -f "$CLAIM" ]; then
  read -r claim_pid claim_ts <"$CLAIM" 2>/dev/null || true
  if [ "${claim_pid:-}" = "$pid" ] && [ $(( $(date +%s) - ${claim_ts:-0} )) -le 5 ]; then
    log "place.sh is moving this window, standing down"
    exit 0
  fi
fi

cur_space=$("$YABAI" -m query --spaces 2>/dev/null | "$JQ" -r '.[] | select(.["has-focus"]) | .index' | head -1)
[ -z "$cur_space" ] && exit 0

# Real, visible windows only. Minimized ones cannot be travelled to, and
# non-standard ones are sheets, popovers and menu bar junk.
wins=$("$YABAI" -m query --windows 2>/dev/null | "$JQ" -c --argjson pid "$pid" --arg ignore "$IGNORE" '
  [ .[]
    | select(.pid == $pid)
    | select(.app | test($ignore) | not)
    | select(.subrole == "AXStandardWindow")
    | select(.["is-minimized"] == false)
    | select(.["is-hidden"] == false)
  ]')

if [ "$(echo "$wins" | "$JQ" 'length')" = "0" ]; then
  # Leave a note for place.sh: the next window this pid opens belongs here.
  printf '%s %s %s\n' "$pid" "$cur_space" "$(date +%s)" >"$PENDING"
  log "no windows, claiming next window for space $cur_space"
  exit 0
fi

log "sees $(echo "$wins" | "$JQ" -c 'map({id,space})') while you are on $cur_space"

# The app has windows, so nothing new is about to be born. Drop any stale note.
rm -f "$PENDING"

# Something of this app is already in front of you. Leave focus alone.
if [ "$(echo "$wins" | "$JQ" -r --argjson sp "$cur_space" '[ .[] | select(.space == $sp) ] | length')" != "0" ]; then
  log "already has a window on $cur_space"
  exit 0
fi

# A pinned app cannot be anywhere but its own space, so there is nothing to be
# unsure about and nothing to wait for. Skip the debounce below and go.
pin=$(pinned_space "$(echo "$wins" | "$JQ" -r '.[0].app // empty')") ||
  pin=$(pinned_space "${app:-}") || pin=""
if [ -n "$pin" ]; then
  wid=$(echo "$wins" | "$JQ" -r --argjson sp "$pin" '(map(select(.space == $sp)) + .) | .[0].id')
  "$YABAI" -m space --focus "$pin" 2>/dev/null
  "$YABAI" -m window --focus "$wid" 2>/dev/null
  log "pinned, went straight to space $pin for window $wid"
  exit 0
fi

wid=$(echo "$wins" | "$JQ" -r '.[0].id')
target=$(echo "$wins" | "$JQ" -r '.[0].space')

# Do not commit to the trip yet. Electron apps like Claude do not remove their
# window from yabai's list when you close it. The stale entry keeps its old
# space, so travelling now means flying to space 3 for a window that place.sh
# is about to move to space 2, and you watch a pointless space flip.
#
# Wait briefly for place.sh to stake a claim. Checking a file costs nothing, so
# poll often and leave the moment we hear something. A real trip to a window
# that is genuinely parked elsewhere pays this delay, but a space switch is
# already slower than this, so you will not feel it.
waited=0
while [ "$waited" -lt 16 ]; do
  if [ -f "$CLAIM" ]; then
    read -r claim_pid _ <"$CLAIM" 2>/dev/null || true
    if [ "${claim_pid:-}" = "$pid" ]; then
      log "place.sh claimed this window mid-debounce, no trip needed"
      exit 0
    fi
  fi
  sleep 0.025
  waited=$(( waited + 1 ))
done

# Last look. place.sh may have finished and released the claim already, or the
# stale window may have been rebuilt on the space you are standing on.
if [ "$("$YABAI" -m query --windows 2>/dev/null | "$JQ" -r --argjson pid "$pid" --argjson sp "$cur_space" '
  [ .[] | select(.pid == $pid and .space == $sp and .subrole == "AXStandardWindow" and (.["is-minimized"] | not)) ] | length')" != "0" ]; then
  log "a window landed on $cur_space while waiting, no trip needed"
  exit 0
fi

# Focus the space first. `window --focus` on its own does not carry you across
# spaces for unmanaged (manage=off) windows, it just silently does nothing.
"$YABAI" -m space --focus "$target" 2>/dev/null
"$YABAI" -m window --focus "$wid" 2>/dev/null
log "travelled to window $wid on space $target"
