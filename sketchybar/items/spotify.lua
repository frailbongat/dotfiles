local colors = require("colors")
local icons = require("icons")

local whitelist = {
	['Spotify'] = true
};

local media = sbar.add('item', 'media', {
	icon = {
    font = {
      family = "JetBrainsMono Nerd Font",
      size = 16.0
    },
    string = "",
		color = "0xffeed49f",
    padding_right = 0,
	},
	position = 'center',
	updates = true,
})

media:subscribe('mouse.clicked', function(env)
	sbar.exec("osascript -e 'tell application \"Spotify\" to playpause'")
end)

media:subscribe('media_change', function(env)
	if whitelist[env.INFO.app] then
		local playback_color = ((env.INFO.state == 'playing') and '0xffa6da95' or '0xffeed49f')

		local artist = (env.INFO.artist ~= "" and env.INFO.artist) or "Unknown Artist"
		local title = (env.INFO.title ~= "" and env.INFO.title) or "Unknown Title"
		local label = artist .. ' - ' .. title

		sbar.animate('tanh', 10, function()
			media:set({
				icon = { color = playback_color },
				label = label
			})
		end)
	end
end)
