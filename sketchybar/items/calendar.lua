local settings = require("settings")
local colors = require("colors")

local cal = sbar.add("item", "cal", {
  position = "right",
  update_freq = 30,
  icon = {
    color = colors.red,
    padding_right = 0,
    string = "󰃰"
  },
  background = {
    padding_left = settings.group_paddings
  }
})

cal:subscribe({ "forced", "routine", "system_woke" }, function(env)
  cal:set({ label = string.gsub(os.date("%a %b %d"), "0(%d)", "%1") .. " " .. string.gsub(os.date("%I:%M %p"), "^0", "") })
end)
