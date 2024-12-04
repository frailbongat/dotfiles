-- Function to check if using an external display or built-in display on Mac
function checkDeviceType()
  local handle = io.popen("system_profiler SPHardwareDataType")
  local result = handle:read("*a")
  handle:close()

  -- Check for Mac Mini or laptop keywords
  if result:find("Mac mini") then
    return "Mac Mini"
  elseif result:find("MacBook") then
    return "Laptop"
  else
    return "Unknown Mac Type"
  end
end

print("You are using: " .. checkDeviceType())
