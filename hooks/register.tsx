import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  barFor,
  compactAtOf,
  effortOf,
  formatDelta,
  formatTokens,
  limitColor,
  limitParts,
  limitOf,
  limitsOf,
  modelName,
  percentOf,
  record,
  sampleOf,
  tokensOf,
  weatherFor,
} from './forecast'

const samples = atom({ plugin: 'token-weather', key: 'samples' } as const, [])
const turn = atom({ plugin: 'token-weather', key: 'turn' } as const, null)
const compactAt = atom({ plugin: 'token-weather', key: 'compactAt' } as const, null)
const limits = atom({ plugin: 'token-weather', key: 'limits' } as const, [])
const engine = atom({ plugin: 'token-weather', key: 'engine' } as const, null)

// The auto-compact point, from the local /context estimate; it sends no request.
async function refreshCompactAt($: EngineInterface): Promise<void> {
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const at = compactAtOf(context.breakdown)
    await update($, compactAt, () => at)
  } catch {
    // Without a reading the band measures against the whole window.
  }
}

export const register: Register = on => {
  // Redraws the band each minute so the rate-limit countdowns stay current.
  let tick: Timer | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    tick?.cancel()
    tick = $.clock.every(60_000, () => $.ui.invalidate('ui.render'))

    await refreshCompactAt($)
    try {
      const model = await $.session.model()
      await update($, engine, now => now ?? { model, effort: null })
    } catch {
      // The first request names it instead.
    }
    try {
      const { rateLimits } = await $.session.usage()
      await update($, limits, () => limitsOf(rateLimits))
    } catch {
      // The windows arrive with the first measurement instead.
    }

    return result
  })

  on('turn.start', async ($, e, next) => {
    await update($, turn, () => e.turnId)

    return next(e)
  })

  // Every model response inside a turn moves the window, so the band follows each one.
  on('turn.step', async function* ($, e, next) {
    // The model and effort this request goes out with, as the engine resolved them.
    if (e.agentId === undefined) {
      const now = { model: e.model, effort: effortOf(e.effort) }
      try {
        await update($, engine, was => (was?.model === now.model && was.effort === now.effort ? was : now))
      } catch {
        // The band keeps the last one it knew.
      }
    }

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
      // The model, and with it the compact point, can change between turns.
      await refreshCompactAt($)
    }
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => limitsOf(e.rateLimits))
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, samples, () => [])
      await update($, turn, () => null)
    } else {
      tick?.cancel()
      tick = undefined
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const list = await read($, samples)
    const at = await read($, compactAt)
    const windows = await read($, limits)
    const running = await read($, engine)
    const now = windows.length > 0 ? await $.clock.now() : 0
    const latest = list.at(-1)
    const { Box, Text } = $.ui.resolve(e)

    const window = latest?.window ?? (await $.session.usage()).context.window
    const limit = limitOf(window, at)

    // The second line: the model and effort, then the five-hour and weekly windows, quiet until one fills.
    const limitsLine = (running !== null || windows.length > 0) && (
      <Text wrap="truncate-end">
        {running !== null && (
          <Text dimColor>
            {'  '}
            {modelName(running.model)}
            {running.effort === null ? '' : ` · ${running.effort}`}
          </Text>
        )}
        {windows.map((w, i) => {
          const parts = limitParts(w, now)
          const color = limitColor(w.percentUsed)
          return (
            <Text>
              <Text dimColor>
                {i === 0 && running === null ? '  ' : '    '}
                {parts.label}{' '}
              </Text>
              {color === undefined
                ? <Text dimColor>{parts.meter} {parts.used}</Text>
                : <Text color={color}>{parts.meter} {parts.used}</Text>}
              {parts.resets !== undefined && <Text dimColor> · resets {parts.resets}</Text>}
            </Text>
          )
        })}
      </Text>
    )

    if (latest === undefined) {
      return (
        <Box flexDirection="column">
          <Text wrap="truncate-end" dimColor>
            ☀ Clear{'  '}— / {formatTokens(limit)}{'  '}waiting for the first response
          </Text>
          {limitsLine}
        </Box>
      )
    }

    const previous = list.at(-2)
    const isLive = e.props.isWorking && latest.turnId === (await read($, turn))
    const percent = percentOf(latest.tokens, limit)
    const weather = weatherFor(percent)

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={weather.color} bold>
            {weather.icon} {weather.word}
          </Text>
          <Text>
            {'  '}
            {percent}% · {formatTokens(latest.tokens)} / {formatTokens(limit)}
            {'  '}
          </Text>
          {list.map(sample => {
            const p = percentOf(sample.tokens, limitOf(sample.window, at))
            return <Text color={weatherFor(p).color}>{barFor(p)}</Text>
          })}
          {previous !== undefined && (
            <Text dimColor>
              {'  '}
              {formatDelta(latest.tokens - previous.tokens, isLive ? 'this turn' : 'last turn')}
            </Text>
          )}
        </Text>
        {limitsLine}
      </Box>
    )
  })
}
