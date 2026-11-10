# Token Weather

A Claude Code mod that draws a live forecast of the context window in the band above the prompt.

```
☁ Cloudy  46% · 76.4k / 167k  ▁▂▂▃▃▄  ▲ +4.2k this turn
  Opus 5.5 · high    5h ▰▱▱▱▱ 23% · resets 2h10m    7d ▰▰▱▱▱ 41% · resets 3d4h
```

The first line is the context window:

- **Scale** is the token count auto-compaction runs at. With auto-compaction off, it is the model's whole window.
- **Weather** follows how close the main window is to that scale: Clear under 25%, Cloudy under 50%, Showers under 75%, Storm under 90%, then Compact soon.
- **Bars** show the last 12 turns, one per turn, against the same scale.
- **Delta** shows how much the window grew or shrank this turn, or the last one while idle.

The second line, dimmed:

- **Model and effort** of the main loop's latest request, as the engine sent it.
- **Rate limits**: how much of the five-hour (`5h`) and weekly (`7d`) windows is used, one meter cell to each fifth, and how long until each resets. A meter turns yellow past 50%, magenta past 80% and red past 95%. They appear on a Claude subscription once a response has reported them.

It reads the main loop's usage after each model response; subagents run in windows of their own and are left out. The auto-compact point comes from the local `/context` estimate after each turn. `/clear` starts the chart over. It writes no files and makes no model calls.

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
