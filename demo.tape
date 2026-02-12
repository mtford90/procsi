Output demo.gif

Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 1200
Set Height 700
Set Padding 20
Set TypingSpeed 40ms

# Launch TUI off-screen, then show once it's rendered
Hide
Type "procsi tui"
Enter
Sleep 2s
Show

# Scroll through request list to show variety
Type "j"
Sleep 500ms
Type "j"
Sleep 500ms
Type "j"
Sleep 500ms

# Now on POST /post - switch to detail panel
Tab
Sleep 600ms

# Navigate through accordion sections to response body
Type "j"
Sleep 500ms
Type "j"
Sleep 500ms
Type "j"
Sleep 500ms

# Open JSON explorer on response body
Enter
Sleep 1s

# Navigate and expand JSON tree
Type "j"
Sleep 400ms
Type "j"
Sleep 400ms
Type "l"
Sleep 500ms
Type "j"
Sleep 400ms
Type "j"
Sleep 400ms

# Close JSON explorer
Escape
Sleep 600ms

# Back to request list
Type "1"
Sleep 500ms

# Open filter and search
Type "/"
Sleep 300ms
Type "post"
Sleep 1s

# Cancel filter to end on full list view
Escape
Sleep 500ms

# Jump to top for a clean ending frame
Type "g"
Sleep 2s
