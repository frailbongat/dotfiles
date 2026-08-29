#!/usr/bin/env bash
# follow.sh <yabai-app-regex> <open -a name>
#
# "Follow me" launcher. Only wire this to apps you want dragged to whatever
# space you're on. Everything else should stay on plain `open -a`.
#
#   window exists anywhere -> move it to your current space, focus it
#   no window at all       -> open -a, new window lands on your current space
#
# Debug: SUMMON_DEBUG=1 ~/.config/skhd/follow.sh '^Zen$' 'Zen Browser'
#        tail -f /tmp/follow.log

set -u

YABAI=/opt/homebrew/bin/yabai
JQ=/opt/homebrew/bin/jq
LOG=/tmp/follow.log

app_regex="$1"
open_name="${2:-$1}"

log() { [ "${SUMMON_DEBUG:-0}" = "1" ] && echo "$(date '+%H:%M:%S') [$app_regex] $*" >>"$LOG"; }

find_window() {
  "$YABAI" -m query --windows 2>/dev/null | "$JQ" -r --arg re "$app_regex" --argjson sp "$1" '
    [ .[] | select(.app | test($re)) | select(.subrole == "AXStandardWindow") ]
    | (map(select(.space == $sp)) + .)
    | .[0].id // empty'
}

cur_space=$("$YABAI" -m query --spaces | "$JQ" -r '.[] | select(.["has-focus"]) | .index' | head -1)
[ -z "$cur_space" ] && cur_space=$("$YABAI" -m query --spaces --space | "$JQ" -r '.index')
log "current space=$cur_space"

wid=$(find_window "$cur_space")

# Firefox-based apps (Zen) destroy and recreate their window when it crosses a
# space, so a single query can miss it. If the app is running, look again.
if [ -z "$wid" ] && osascript -e "application \"$open_name\" is running" 2>/dev/null | grep -q true; then
  for _ in 1 2 3; do
    sleep 0.15
    wid=$(find_window "$cur_space")
    [ -n "$wid" ] && break
  done
  log "retried lookup -> wid=${wid:-none}"
fi

if [ -z "$wid" ]; then
  log "no window -> open -a '$open_name'"
  open -a "$open_name"
  exit 0
fi

state=$("$YABAI" -m query --windows --window "$wid" 2>/dev/null)
log "window id=$wid space=$(echo "$state" | "$JQ" -r '.space')"

# un-minimize / un-hide first, otherwise the move is a no-op
[ "$(echo "$state" | "$JQ" -r '.["is-minimized"]')" = "true" ] && "$YABAI" -m window "$wid" --deminimize 2>/dev/null
if [ "$(echo "$state" | "$JQ" -r '.["is-hidden"]')" = "true" ]; then
  pid=$(echo "$state" | "$JQ" -r '.pid')
  osascript -e "tell application \"System Events\" to set visible of (first process whose unix id is $pid) to true" >/dev/null 2>&1
  sleep 0.15
fi

for attempt in 1 2; do
  win_space=$("$YABAI" -m query --windows --window "$wid" 2>/dev/null | "$JQ" -r '.space')
  [ "$win_space" = "$cur_space" ] && break
  err=$("$YABAI" -m window "$wid" --space "$cur_space" 2>&1)
  log "move $attempt: $win_space -> $cur_space ${err:+(err: $err)}"
  sleep 0.1
done

"$YABAI" -m window --focus "$wid" 2>/dev/null || open -a "$open_name"
log "done, space=$("$YABAI" -m query --windows --window "$wid" 2>/dev/null | "$JQ" -r '.space')"
