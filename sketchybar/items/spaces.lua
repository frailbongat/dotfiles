local colors = require("colors")
local icons = require("icons")
local settings = require("settings")
local app_icons = require("helpers.app_icons")

local spaces = {}

for i = 1, 10, 1 do
  local space = sbar.add("space", "space." .. i, {
    space = i,
    icon = {
      font = { family = settings.font.numbers },
      string = i,
      padding_right = 2,
      highlight_color = colors.red,
    },
    label = {
      color = colors.grey,
      highlight_color = colors.white,
      font = "sketchybar-app-font:Regular:12.0",
      y_offset = -1,
    },
    background = {
      padding_right = 5
    },
  })

  spaces[i] = space

  space:subscribe("space_change", function(env)
    local selected = env.SELECTED == "true"
    space:set({
      icon = { highlight = selected, },
      label = { highlight = selected },
    })
  end)

  space:subscribe("mouse.clicked", function(env)
    local op = "--focus"
    sbar.exec("yabai -m space " .. op .. " " .. env.SID)
  end)
end


local spaces_bracket = sbar.add("bracket", {
  'space.1', 'space.2', 'space.3', 'space.4'
}, {
  background = {
    color = colors.red
  },
})

local space_window_observer = sbar.add("item", {
  drawing = false,
  updates = true,
})

space_window_observer:subscribe("space_windows_change", function(env)
  local icon_line = ""
  local no_app = true
  for app, count in pairs(env.INFO.apps) do
    no_app = false
    local lookup = app_icons[app]
    local icon = ((lookup == nil) and app_icons["Default"] or lookup)
    icon_line = icon_line .. icon
  end

  if (no_app) then
    icon_line = " —"
  end
  sbar.animate("tanh", 10, function()
    spaces[env.INFO.space]:set({ label = icon_line })
  end)
end)
