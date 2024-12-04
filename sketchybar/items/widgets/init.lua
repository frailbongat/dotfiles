-- Function to check if the Mac device has a battery
function hasBattery()
  local handle = io.popen("system_profiler SPPowerDataType | grep 'Battery Information'")
  local result = handle:read("*a")
  handle:close()

  -- Check for battery presence
  if result == "" then
    return false
  else
    return true
  end
end

if hasBattery() then
  print("This device has a battery.")
  require("items.widgets.battery")
end
require("items.widgets.volume")
require("items.widgets.cpu")
