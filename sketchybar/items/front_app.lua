local colors = require("colors")
local settings = require("settings")

local front_app = sbar.add("item", "front_app", {
  display = "active",
  icon = { drawing = false },
  label = {
    font = {
      style = settings.font.style_map["Heavy"],
    },
  },
  background = {
    padding_left = 5
  },
  updates = true,
})

front_app:subscribe("front_app_switched", function(env)
  front_app:set({ label = { string = env.INFO } })
end)
