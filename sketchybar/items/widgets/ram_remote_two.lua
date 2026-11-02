local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

local POLL_SECONDS = 5

sbar.add("item", "widgets.ram_remote_two.padding", {
  position = "right",
  width = settings.group_paddings
})

local ram_remote_two = sbar.add("graph", "widgets.ram_remote_two", 42, {
  position = "right",
  graph = { color = colors.blue },
  background = {
    color = { alpha = 0 },
    border_color = { alpha = 0 },
    drawing = true,
  },
  icon = {
    string = icons.ram,
    color = colors.yellow
  },
  label = {
    string = "rem2 --",
    font = {
      family = settings.font.numbers,
      style = settings.font.style_map["Bold"],
      size = 9.0,
    },
    align = "right",
    padding_right = 0,
    width = 0,
    y_offset = 4
  },
  padding_right = settings.paddings,
  update_freq = POLL_SECONDS,
})

local helper_running = false

local function parse_used_percent(result)
  local used = tonumber(tostring(result or ""):match("^%s*(%d+)%s*$"))
  if used and used <= 100 then return used end
  return nil
end

local function refresh()
  if helper_running then return end
  helper_running = true

  sbar.exec("$CONFIG_DIR/helpers/remote_ram.sh", function(result)
    helper_running = false

    local used = parse_used_percent(result)

    if not used then
      ram_remote_two:push({ 0 })
      ram_remote_two:set({
        graph = { color = colors.grey },
        icon = { color = colors.grey },
        label = "rem2 --",
      })
      return
    end

    ram_remote_two:push({ used / 100. })

    local color = colors.blue
    if used > 30 then
      if used < 60 then
        color = colors.yellow
      elseif used < 80 then
        color = colors.orange
      else
        color = colors.red
      end
    end

    ram_remote_two:set({
      graph = { color = color },
      icon = { color = colors.yellow },
      label = "rem2 " .. used .. "%",
    })
  end)
end

ram_remote_two:subscribe({ "routine", "forced", "system_woke" }, refresh)

ram_remote_two:subscribe("mouse.clicked", function()
  refresh()
end)

sbar.add("bracket", "widgets.ram_remote_two.bracket", { ram_remote_two.name }, {
  background = { color = colors.bg1 }
})
