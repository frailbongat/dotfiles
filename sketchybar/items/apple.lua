local colors = require("colors")
local icons = require("icons")
local settings = require("settings")

-- Padding item required because of bracket
sbar.add("item")

local apple = sbar.add("item", {
  icon = {
    string = icons.apple,
    color = colors.green
  },
  background = {
    padding_right = settings.group_paddings
  },
  label = { drawing = false },
  click_script = "$CONFIG_DIR/helpers/menus/bin/menus -s 0",
})

-- Padding item required because of bracket
sbar.add("item")
