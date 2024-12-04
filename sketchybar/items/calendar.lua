local settings = require("settings")
local colors = require("colors")

local cal = sbar.add("item", {
  icon = {
    color = colors.red,
    padding_right = 0,
    font = {
      style = settings.font.style_map["Medium"],
      size = 12.0,
    },
  },
  position = "right",
  update_freq = 30,
  background = {
    padding_left = settings.group_paddings
  },
  label = { font = { family = settings.font.numbers } },
})

cal:subscribe({ "forced", "routine", "system_woke" }, function(env)
  cal:set({ icon = os.date("%a %b %d"), label = string.gsub(os.date("%I:%M %p"), "^0", "") })
end)
