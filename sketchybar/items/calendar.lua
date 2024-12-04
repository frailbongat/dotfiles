local settings = require("settings")
local colors = require("colors")

local cal_time = sbar.add("item", "cal_time", {
  position = "right",
  update_freq = 30,
  background = {
    padding_left = 0
  },
  label = {
    font = { family = settings.font.numbers },
    padding_left = 0,
  },
  icon = {
    drawing = false
  }
})

local cal_date = sbar.add("item", "cal_date", {
  position = "right",
  update_freq = 30,
  icon = {
    color = colors.red,
    padding_right = 0,
    string = "􀧞"
  },
})

local cal_bracket = sbar.add("bracket", "calendar.bracket", {
  cal_time.name,
  cal_date.name
}, {
  background = {
    color = colors.bg1,
  },
})

sbar.add("item", "calendar.padding", {
  position = "right",
  width = settings.group_paddings
})

cal_time:subscribe({ "forced", "routine", "system_woke" }, function(env)
  cal_time:set({ label = string.gsub(os.date("%I:%M %p"), "^0", "") })
end)

cal_date:subscribe({ "forced", "routine", "system_woke" }, function(env)
  cal_date:set({ label = string.gsub(os.date("%a %b %d"), "0(%d)", "%1") })
end)
