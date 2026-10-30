# Token Weather

A Claude Code mod that draws a live forecast of the context window in the band above the prompt.

```
☁ Cloudy  38% · 76.4k / 200k  ▁▂▂▃▃▄  ▲ +4.2k this turn
```

- **Weather** follows how full the main window is: Clear under 25%, Cloudy under 50%, Showers under 75%, Storm under 90%, then Compact soon.
- **Bars** show the last 12 turns, one per turn, scaled to the whole window.
- **Delta** shows how much the window grew or shrank this turn, or the last one while idle.

It reads the main loop's usage after each model response; subagents run in windows of their own and are left out. `/clear` starts the chart over. It writes no files and makes no model calls.

## Install

Add it to a marketplace with a GitHub source:

```json
{
  "name": "token-weather",
  "source": { "source": "github", "repo": "Ruisi-Lu/token-weather" }
}
```

Then `claude plugin install token-weather@<marketplace>` and start a new session.

## Develop

```bash
claude plugin validate . --strict
claude plugin test .
```

## License

[MIT](LICENSE)
