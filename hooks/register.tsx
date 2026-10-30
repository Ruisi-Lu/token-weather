import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { barFor, formatDelta, formatTokens, record, sampleOf, tokensOf, weatherFor } from './forecast'

const samples = atom({ plugin: 'token-weather', key: 'samples' } as const, [])
const turn = atom({ plugin: 'token-weather', key: 'turn' } as const, null)

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    await update($, turn, () => e.turnId)

    return next(e)
  })

  // Every model response inside a turn moves the window, so the band follows each one.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)

    // Subagents run in windows of their own; only the main loop's counts.
    if (e.agentId === undefined && result.usage !== null) {
      try {
        const { context } = await $.session.usage()
        const sample = sampleOf({ window: context.window, tokens: tokensOf(result.usage) }, e.turnId)
        if (sample !== null) {
          await update($, samples, list => record(list, sample))
        }
      } catch {
        // A forecast that cannot be read never holds up the model's response.
      }
    }

    return result
  })

  // The engine's own figures once a turn settles, as the status line reads them.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await update($, samples, list => {
        const sample = sampleOf(e.context, list.at(-1)?.turnId ?? '')
        return sample === null ? list : record(list, sample)
      })
    }

    return next(e)
  })

  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await update($, samples, () => [])
    await update($, turn, () => null)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const list = await read($, samples)
    const latest = list.at(-1)
    const { Box, Text } = $.ui.resolve(e)

    if (latest === undefined) {
      const { context } = await $.session.usage()
      return (
        <Box>
          <Text wrap="truncate-end" dimColor>
            ☀ Clear{'  '}— / {formatTokens(context.window)}{'  '}waiting for the first response
          </Text>
        </Box>
      )
    }

    const previous = list.at(-2)
    const isLive = e.props.isWorking && latest.turnId === (await read($, turn))
    const weather = weatherFor(latest.percent)

    return (
      <Box>
        <Text wrap="truncate-end">
          <Text color={weather.color} bold>
            {weather.icon} {weather.word}
          </Text>
          <Text>
            {'  '}
            {latest.percent}% · {formatTokens(latest.tokens)} / {formatTokens(latest.window)}
            {'  '}
          </Text>
          {list.map(sample => (
            <Text color={weatherFor(sample.percent).color}>{barFor(sample.percent)}</Text>
          ))}
          {previous !== undefined && (
            <Text dimColor>
              {'  '}
              {formatDelta(latest.tokens - previous.tokens, isLive ? 'this turn' : 'last turn')}
            </Text>
          )}
        </Text>
      </Box>
    )
  })
}
