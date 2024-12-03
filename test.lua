function isLaptopDisplay()
  -- Execute the 'system_profiler SPDisplaysDataType' command and capture the output
  local handle = io.popen("system_profiler SPDisplaysDataType")
  local result = handle:read("*all")
  handle:close()

  -- Check if the output mentions 'Built-in Retina Display' or something similar
  if string.match(result, "Built-in") then
      return true  -- It's a laptop display
  else
      return false  -- External monitor is connected
  end
end

-- Example usage:
if isLaptopDisplay() then
  print("You are using the laptop's built-in display.")
else
  print("You are using an external monitor.")
end
