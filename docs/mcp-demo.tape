# Records docs/mcp-demo.gif — a real MCP booking-agent session.
#
#   1. install vhs:  https://github.com/charmbracelet/vhs  (`brew install vhs` / `go install`)
#   2. build the server:  pnpm --filter @aisbp/mcp-server build
#   3. export GEMINI_API_KEY / DATABASE_URL / AISBP_MCP_ACTOR_EMAIL
#      (or drop `require` below to the offline `--scripted` demo — no key)
#   4. vhs docs/mcp-demo.tape
#
# The DB must have open washing-machine-installation slots on the date used
# below; adjust the prompt to a real open date for your seed data.

Output docs/mcp-demo.gif

Require pnpm

Set Shell bash
Set FontSize 15
Set Width 1100
Set Height 640
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Hide
Type "pnpm --filter @aisbp/mcp-client chat -- --scripted --memory"
Enter
Sleep 3s
Show

Sleep 1.5s
Type "What washing machine installation slots are open soon?"
Enter
Sleep 6s

Type "Book the earliest one."
Enter
Sleep 8s

Type "/exit"
Enter
Sleep 2s
