#!/usr/bin/env sh
#
# Fullscreen toggle for the focused window, whoever owns it.
#
# yabai's own `--toggle zoom-fullscreen` only moves windows that live in the
# bsp tree. On a floating or unmanaged window it exits 0 and does nothing, so
# every app with `manage=off` in yabairc, plus anything toggled with alt - p,
# would get a dead key. This script picks the right mechanism per window:
#
#   native fullscreen  -> hand back to macOS, yabai cannot resize that window
#   managed (tiled)    -> zoom-fullscreen, restores to its exact tile
#   floating/unmanaged -> resize to fill the display, old frame stashed in /tmp
#
# Padding and bar height are read from the live yabai config so this stays in
# sync with yabairc instead of hardcoding 8 and 32.

set -eu

win=$(yabai -m query --windows --window 2>/dev/null) || exit 0
[ -z "$win" ] && exit 0

id=$(printf '%s' "$win" | jq -r '.id')
floating=$(printf '%s' "$win" | jq -r '."is-floating"')
native=$(printf '%s' "$win" | jq -r '."is-native-fullscreen"')

if [ "$native" = "true" ]; then
  yabai -m window --toggle native-fullscreen
  exit 0
fi

if [ "$floating" != "true" ]; then
  yabai -m window --toggle zoom-fullscreen
  exit 0
fi

stash="/tmp/skhd-fullscreen-$id"

if [ -f "$stash" ]; then
  read -r x y w h < "$stash"
  rm -f "$stash"
  yabai -m window --move abs:"$x":"$y"
  yabai -m window --resize abs:"$w":"$h"
  exit 0
fi

printf '%s' "$win" | jq -r '.frame | "\(.x) \(.y) \(.w) \(.h)"' > "$stash"

display=$(yabai -m query --displays --display)
dx=$(printf '%s' "$display" | jq -r '.frame.x | floor')
dy=$(printf '%s' "$display" | jq -r '.frame.y | floor')
dw=$(printf '%s' "$display" | jq -r '.frame.w | floor')
dh=$(printf '%s' "$display" | jq -r '.frame.h | floor')

pad_t=$(yabai -m config top_padding)
pad_b=$(yabai -m config bottom_padding)
pad_l=$(yabai -m config left_padding)
pad_r=$(yabai -m config right_padding)

# external_bar reads back as `all:32:0`, meaning 32px reserved at the top and
# 0px at the bottom. Anything unparseable falls back to no reservation.
bar=$(yabai -m config external_bar | cut -d: -f2)
case "$bar" in ''|*[!0-9]*) bar=0 ;; esac

yabai -m window --move abs:$((dx + pad_l)):$((dy + bar + pad_t))
yabai -m window --resize abs:$((dw - pad_l - pad_r)):$((dh - bar - pad_t - pad_b))
