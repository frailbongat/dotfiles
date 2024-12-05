local https = require("ssl.https")
local json = require("dkjson")
local settings = require("settings")

local function getLocation()
  local response, status = https.request("https://ipinfo.io/json")
  if status == 200 then
    local location_data = json.decode(response)
    return location_data.city
  else
    return nil
  end
end

local function getWeather(location)
  local formatted_location = location:gsub(" ", "+")
  local url = string.format("http://wttr.in/%s?format=%%c%%l+•+%%t+%%C", formatted_location)
  local response, status = https.request(url)

  if status == 200 then
    local output = response:gsub("%+", " "):gsub("•%s+", "• ")
    return output
  else
    return "Failed to get weather condition"
  end
end

local weather = sbar.add('item', 'weather', {
	icon = { drawing = false	},
	position = 'center',
  background = {
    padding_right = settings.group_paddings
  }
})

weather:subscribe({ "forced", "routine", "system_woke" }, function(env)
  local current_location = getLocation()
  local current_weather = getWeather(current_location)
  weather:set({
    label = current_weather
  })
end)
