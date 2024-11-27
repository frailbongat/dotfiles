#!/usr/bin/env zsh

case ${INFO} in
0)
  ICON="􀊣"
  ICON_PADDING_RIGHT=6
  ;;
[0-9])
  ICON="􀊥"
  ICON_PADDING_RIGHT=6
  ;;
[1-3][0-9])
  ICON="􀊥"
  ICON_PADDING_RIGHT=6
  ;;
[4-6][0-9])
  ICON="􀊧"
  ICON_PADDING_RIGHT=6
  ;;
*)
  ICON="􀊩"
  ICON_PADDING_RIGHT=6
  ;;
esac

sketchybar --set $NAME icon=$ICON icon.padding_right=$ICON_PADDING_RIGHT label="$INFO%"
