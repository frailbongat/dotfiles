#!/usr/bin/env bash
# jump.sh <yabai-app-regex> <open -a name>
#
# "Jump to me" launcher for apps that keep their own space.
#
#   window exists -> focus it, macOS switches to that window's space
#   no window     -> the new window is forced onto the space you're on
#
# "No window" covers two cases that look the same to you but not to macOS:
# the app is not running at all, and the app is running with every window
# closed (white dot in the Dock). In the second case macOS remembers the last
# space the app lived on and reopens there, so we have to drag the window back.
#
# Pairs with yabairc having no `space=` rule for the app. The rule would
# yank a first-launch window off to a fixed space, which is what we don't
# want anymore.
#
# Debug: SUMMON_DEBUG=1 ~/.config/skhd/jump.sh '^Code$' 'Visual Studio Code'
#        tail -f /tmp/jump.log

set -u

YABAI=/opt/homebrew/bin/yabai
JQ=/opt/homebrew/bin/jq
LOG=/tmp/jump.log

app_regex="$1"
open_name="${2:-$1}"

log() { [ "${SUMMON_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [$app_regex] $*" >>"$LOG"; }

cur_space=$("$YABAI" -m query --spaces | "$JQ" -r '.[] | select(.["has-focus"]) | .index' | head -1)
[ -z "$cur_space" ] && cur_space=$("$YABAI" -m query --spaces --space | "$JQ" -r '.index')

# Prefer a window already on the current space, then any other window.
wid=$("$YABAI" -m query --windows 2>/dev/null | "$JQ" -r --arg re "$app_regex" --argjson sp "$cur_space" '
  [ .[] | select(.app | test($re)) | select(.subrole == "AXStandardWindow") ]
  | (map(select(.space == $sp)) + .)
  | .[0].id // empty')

log "current space=$cur_space wid=${wid:-none}"

if [ -z "$wid" ]; then
  log "no window -> open -a '$open_name' onto space $cur_space"

  # A one-shot rule catches the next window this app spawns and puts it on our
  # space. `^` means follow, so focus comes back here if macOS moved us away.
  # It deletes itself once it fires.
  label="jump-$(echo "$app_regex" | tr -c '[:alnum:]' '-')"
  "$YABAI" -m rule --remove "$label" 2>/dev/null
  "$YABAI" -m rule --add --one-shot label="$label" app="$app_regex" space="^$cur_space" 2>/dev/null

  open -a "$open_name"

  # The rule can miss: unmanaged windows, slow apps, or a helper window
  # spawning first. Poll for the real window and move it ourselves.
  for _ in $(seq 1 20); do
    sleep 0.15
    wid=$("$YABAI" -m query --windows 2>/dev/null | "$JQ" -r --arg re "$app_regex" '
      [ .[] | select(.app | test($re)) | select(.subrole == "AXStandardWindow") ] | .[0].id // empty')
    [ -n "$wid" ] && break
  done

  "$YABAI" -m rule --remove "$label" 2>/dev/null

  if [ -z "$wid" ]; then
    log "no window appeared, giving up"
    exit 0
  fi

  for attempt in 1 2 3; do
    win_space=$("$YABAI" -m query --windows --window "$wid" 2>/dev/null | "$JQ" -r '.space')
    [ "$win_space" = "$cur_space" ] && break
    err=$("$YABAI" -m window "$wid" --space "$cur_space" 2>&1)
    log "move $attempt: $win_space -> $cur_space ${err:+(err: $err)}"
    sleep 0.1
  done

  "$YABAI" -m space --focus "$cur_space" 2>/dev/null
  "$YABAI" -m window --focus "$wid" 2>/dev/null
  log "opened $wid on space $("$YABAI" -m query --windows --window "$wid" 2>/dev/null | "$JQ" -r '.space')"
  exit 0
fi

state=$("$YABAI" -m query --windows --window "$wid" 2>/dev/null)

# A minimized or hidden window cannot take focus, so wake it first.
[ "$(echo "$state" | "$JQ" -r '.["is-minimized"]')" = "true" ] && "$YABAI" -m window "$wid" --deminimize 2>/dev/null
if [ "$(echo "$state" | "$JQ" -r '.["is-hidden"]')" = "true" ]; then
  pid=$(echo "$state" | "$JQ" -r '.pid')
  osascript -e "tell application \"System Events\" to set visible of (first process whose unix id is $pid) to true" >/dev/null 2>&1
  sleep 0.15
fi

"$YABAI" -m window --focus "$wid" 2>/dev/null || open -a "$open_name"
log "focused $wid on space $(echo "$state" | "$JQ" -r '.space')"
