local settings = require("settings")

local reminder = sbar.add('item', 'reminder', {
	icon = { drawing = false	},
	position = 'center',
  background = {
    padding_right = settings.group_paddings
  }
})

reminder:subscribe({ "forced", "routine", "system_woke" }, function(env)
  reminder:set({
    label = "Don't overwork • Note down next steps"
  })
end)
