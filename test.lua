-- Function to check if using an external display or built-in display on Mac
function checkDisplayType()
  local handle = io.popen("system_profiler SPDisplaysDataType")
  local result = handle:read("*a")
  handle:close()

  -- Print the result for debugging purposes
  print(result)

  -- Check if the result contains a display that is not built-in
  if result:find("Built-In") then
      return "Built-in Display"
  else
      return "External Display"
  end
end

-- Example usage
print("You are using: " .. checkDisplayType())
