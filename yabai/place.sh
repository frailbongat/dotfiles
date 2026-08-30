#!/usr/bin/env bash
# place.sh <window-id>   (wired to yabai's window_created signal)
#
# Second half of the pair with travel.sh. travel.sh notices you activating an
# app that has no windows and writes down where you were standing. When that
# app's window finally appears, this drags it to that space.
#
# macOS remembers a space per running app, not per window, so an app you closed
# the last window of still reopens on its old space. Neither the Dock default
# nor a yabai rule fixes that, because the window is born on the wrong space and
# has to be moved after the fact.
#
# Do not assume travel.sh ran first. macOS fires window_created BEFORE
# application_activated when reopening an app that is still running with no
# windows, which is exactly the case this script exists for. So the pending
# note travel.sh leaves is a hint, not a requirement.
#
# What keeps this from yanking every background window into your face is the
# only-window test. A window born on the wrong space when its app has no other
# window is a launch or a reopen, which you asked for. A window born while the
# app already has windows is a second window, like a compose or popout, and it
# belongs where its app already lives.
#
# Debug: touch /tmp/yabai-debug, then tail -f /tmp/travel.log
#        rm /tmp/yabai-debug to stop. A file, not an env var, because yabai
#        signals run in a bare shell you cannot export into.

set -u

YABAI=/opt/homebrew/bin/yabai
JQ=/opt/homebrew/bin/jq
LOG=/tmp/travel.log
PENDING=/tmp/yabai-pending-launch

# How long after activating an app we still believe a new window belongs to
# that launch. Long enough for a cold app, short enough that an unrelated
# window minutes later is never grabbed.
MAX_AGE=15

# Held while we move a window, so the application_activated signal firing at the
# same moment does not read the half-moved window and travel you to its old
# space. travel.sh checks this.
CLAIM=/tmp/yabai-placing

wid="${1:-${YABAI_WINDOW_ID:-}}"
[ -z "$wid" ] && exit 0

# Milliseconds matter here: the whole bug is about which signal wins a race.
# bash 3.2 ships with macOS and has no EPOCHREALTIME, hence perl.
now() { perl -MTime::HiRes -e 'my $t=Time::HiRes::time; my @l=localtime $t; printf "%02d:%02d:%02d.%03d", $l[2], $l[1], $l[0], ($t-int $t)*1000'; }
log() { { [ -f /tmp/yabai-debug ] || [ "${PLACE_DEBUG:-0}" = "1" ]; } && echo "$(now) place ${app:-?}(wid $wid) $*" >>"$LOG"; return 0; }

# One query, one jq. travel.sh is waiting on this script, so every spawn here
# is delay the user sees as a stalled app.
state=$("$YABAI" -m query --windows --window "$wid" 2>/dev/null) || exit 0
[ -z "$state" ] && exit 0
IFS="$(printf '\t')" read -r win_pid win_space subrole app <<EOF
$(echo "$state" | "$JQ" -r '[.pid, .space, .subrole, .app] | @tsv')
EOF

# Sheets, popovers and dialogs ride along with their parent. Moving them
# separately tears them off it.
[ "$subrole" != "AXStandardWindow" ] && exit 0

# Where you are standing. Trustworthy only because the Dock's
# workspaces-auto-swoosh is off, so macOS no longer moves you on activation.
want_space=$("$YABAI" -m query --spaces 2>/dev/null | "$JQ" -r '.[] | select(.["has-focus"]) | .index' | head -1)

# A fresh note from travel.sh beats the live query, because it was taken before
# anything had a chance to move you.
if [ -f "$PENDING" ]; then
  read -r note_pid note_space note_ts <"$PENDING" 2>/dev/null || true
  if [ -n "${note_ts:-}" ] && [ "$note_pid" = "$win_pid" ] && [ $(( $(date +%s) - note_ts )) -le "$MAX_AGE" ]; then
    want_space=$note_space
  fi
  rm -f "$PENDING"
fi

[ -z "$want_space" ] && exit 0

if [ "$win_space" = "$want_space" ]; then
  log "born on space $want_space, already right"
  exit 0
fi

# Any other window for this app means this is a second window, not a reopen.
others=$("$YABAI" -m query --windows 2>/dev/null | "$JQ" -r --argjson pid "$win_pid" --argjson wid "$wid" '
  [ .[]
    | select(.pid == $pid)
    | select(.id != $wid)
    | select(.subrole == "AXStandardWindow")
    | select(.["is-minimized"] == false)
  ] | length')
if [ "$others" != "0" ]; then
  log "born on $win_space but app has $others other window(s), leaving it"
  exit 0
fi

printf '%s %s\n' "$win_pid" "$(date +%s)" >"$CLAIM"

for attempt in 1 2 3; do
  "$YABAI" -m window "$wid" --space "$want_space" 2>/dev/null
  sleep 0.1
  now=$("$YABAI" -m query --windows --window "$wid" 2>/dev/null | "$JQ" -r '.space')
  [ "$now" = "$want_space" ] && break
  log "move attempt $attempt: still on $now"
done

"$YABAI" -m space --focus "$want_space" 2>/dev/null
"$YABAI" -m window --focus "$wid" 2>/dev/null
rm -f "$CLAIM"
log "moved from $win_space to $want_space"
