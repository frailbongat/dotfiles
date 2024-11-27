#!/bin/bash

IP=$(curl -s https://ipinfo.io/ip)
LOCATION_JSON=$(curl -s https://ipinfo.io/$IP/json)

LOCATION="$(echo $LOCATION_JSON | jq '.city' | tr -d '"')"
REGION="$(echo $LOCATION_JSON | jq '.region' | tr -d '"')"

LOCATION_ESCAPED="${LOCATION// /+}"

WEATHER_JSON=$(curl -s "https://wttr.in/$LOCATION_ESCAPED?format=j1")

MOON_PHASE=$(echo $WEATHER_JSON | jq '.weather[0]' | tr -d '"')

echo $WEATHER_JSON
