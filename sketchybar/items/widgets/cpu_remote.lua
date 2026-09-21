local icons = require("icons")
local colors = require("colors")
local settings = require("settings")

-- CPU load of a remote Mac, polled over ssh (tailscale).
local REMOTE_HOST = "fraildev@josh-mac-mini"
local POLL_SECONDS = 5

-- Spacer so this sits beside the local cpu widget with the same gap the other
-- widget groups use.
sbar.add("item", "widgets.cpu_remote.padding", {
  position = "right",
  width = settings.group_paddings
})

local cpu_remote = sbar.add("graph", "widgets.cpu_remote", 42, {
  position = "right",
  graph = { color = colors.blue },
  background = {
    color = { alpha = 0 },
    border_color = { alpha = 0 },
    drawing = true,
  },
  icon = {
    string = icons.cpu,
    color = colors.yellow
  },
  label = {
    string = "rem --",
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

local function refresh()
  sbar.exec("REMOTE_CPU_HOST=" .. REMOTE_HOST .. " $CONFIG_DIR/helpers/remote_cpu.sh", function(result)
    local load = tonumber((result or ""):match("%d+"))

    if not load then
      -- Host unreachable or ssh not permitted.
      cpu_remote:push({ 0 })
      cpu_remote:set({
        graph = { color = colors.grey },
        icon = { color = colors.grey },
        label = "rem --",
      })
      return
    end

    cpu_remote:push({ load / 100. })

    local color = colors.blue
    if load > 30 then
      if load < 60 then
        color = colors.yellow
      elseif load < 80 then
        color = colors.orange
      else
        color = colors.red
      end
    end

    cpu_remote:set({
      graph = { color = color },
      icon = { color = colors.yellow },
      label = "rem " .. load .. "%",
    })
  end)
end

cpu_remote:subscribe({ "routine", "forced", "system_woke" }, refresh)

cpu_remote:subscribe("mouse.clicked", function()
  refresh()
end)

-- Background around the remote cpu item
sbar.add("bracket", "widgets.cpu_remote.bracket", { cpu_remote.name }, {
  background = { color = colors.bg1 }
})
