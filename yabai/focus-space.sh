#!/usr/bin/env bash
# focus-space.sh <space index>
#
# Switch to a space, even when yabai cannot.
#
# `yabai -m space --focus` needs the scripting addition, and on macOS 27 the
# scripting addition does not load (asmvik/yabai#2800). yabai still exits 0,
# so the switch fails silently. When the space did not change, we press the
# macOS "Switch to Desktop N" shortcut (ctrl + N) instead. Those shortcuts are
# enabled in System Settings > Keyboard > Keyboard Shortcuts > Mission Control.
#
# Desktop N only equals yabai space N on a single display.

YABAI=/opt/homebrew/bin/yabai
JQ=/opt/homebrew/bin/jq
SKHD=/opt/homebrew/bin/skhd

target="$1"
[ -z "$target" ] && exit 1

"$YABAI" -m space --focus "$target" 2>/dev/null

now=$("$YABAI" -m query --spaces --space 2>/dev/null | "$JQ" -r '.index')
[ "$now" = "$target" ] && exit 0

# Only desktops 1 to 9 have a ctrl + digit shortcut.
[ "$target" -ge 1 ] 2>/dev/null && [ "$target" -le 9 ] || exit 1
"$SKHD" -k "ctrl - $target"

# Give macOS time to finish the slide, so callers that focus a window next
# land on the new space.
for _ in 1 2 3 4 5 6 7 8; do
  sleep 0.05
  now=$("$YABAI" -m query --spaces --space 2>/dev/null | "$JQ" -r '.index')
  [ "$now" = "$target" ] && exit 0
done
exit 0
