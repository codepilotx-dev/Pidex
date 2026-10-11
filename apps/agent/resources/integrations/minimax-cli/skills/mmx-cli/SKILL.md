---
name: mmx-cli
description: Use the installed official MiniMax CLI for text, image, video, speech, music, vision, search, and quota tasks.
---

# MiniMax CLI

Use the official `mmx` executable supplied by the MiniMax CLI integration. Do not install, update, or uninstall it from a conversation; direct the user to the plugin page when it is unavailable.

Before a request that spends quota, run `mmx auth status --output json --quiet`. Never print, repeat, or place an API key in a command. Pidex synchronizes the active MiniMax Coding Plan key into the official mmx configuration when available.

For agent calls, use `--non-interactive`, `--quiet`, and `--output json` whenever the command supports them.

Common commands:

```bash
mmx text chat --message "user:<message>" --output json --quiet --non-interactive
mmx image generate --prompt "<prompt>" --out-dir "<directory>" --output json --quiet --non-interactive
mmx video generate --prompt "<prompt>" --download "<output.mp4>" --quiet --non-interactive
mmx speech synthesize --text "<text>" --out "<output.mp3>" --quiet --non-interactive
mmx music generate --prompt "<prompt>" --instrumental --out "<output.mp3>" --quiet --non-interactive
mmx vision describe --image "<path>" --prompt "<question>" --output json --quiet --non-interactive
mmx search query --q "<query>" --output json --quiet --non-interactive
mmx quota show --output json --quiet --non-interactive
```

Use `h3-video/SKILL.md` for MiniMax-H3 video requests. Preserve returned task IDs and never submit a duplicate paid task merely because local waiting or downloading was interrupted.

If authentication is missing, ask the user to run `mmx auth login`. Do not ask them to paste a key into the conversation.

Exit codes: `0` success, `2` invalid arguments, `3` authentication, `4` quota, `5` timeout, and `10` content filtering.

Source: https://github.com/MiniMax-AI/cli
