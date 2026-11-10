import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { SessionContextBreakdown, SessionContextUsage, SessionRateLimit, TurnUsage } from 'claude-code'

import {
  barFor,
  compactAtOf,
  formatDelta,
  formatLimit,
  formatRemaining,
  formatTokens,
  limitColor,
  limitOf,
  limitsOf,
  percentOf,
  record,
  sampleOf,
  tokensOf,
  weatherFor,
} from '../hooks/forecast'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const WORKING = { ...BAND, props: { ...BAND.props, isWorking: true } } as const

// A response answered over `tokens` of input, split the way a cached request reports it.
const usageOf = (tokens: number): TurnUsage => ({
  input_tokens: 10,
  cache_creation_input_tokens: 1_000,
  cache_read_input_tokens: tokens - 1_010,
  output_tokens: 500,
  model: 'claude-test',
})

// The /context estimate, reduced to what the band reads: where auto-compaction runs.
const breakdownOf = (threshold: number | undefined, isEnabled = true): SessionContextBreakdown => ({
  categories: [],
  totalTokens: 0,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'model-default',
  percentage: 0,
  gridRows: [],
  model: 'claude-test',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  ...(threshold === undefined ? {} : { autoCompactThreshold: threshold }),
  isAutoCompactEnabled: isEnabled,
  apiUsage: null,
})

const NOW = Date.parse('2026-11-10T10:00:00Z')
const RATE_LIMITS: SessionRateLimit[] = [
  { kind: 'seven_day', percentUsed: 41.2, resetsAt: '2026-11-13T14:00:00Z' },
  { kind: 'spend_limit', percentUsed: 10 },
  { kind: 'five_hour', percentUsed: 82.5, resetsAt: '2026-11-10T12:10:00Z' },
]

// Raises one model request of a turn and reads its stream to the end, as the query loop does.
async function step($: Engine, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId, index, model: 'claude-test', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
  for await (const _ of stream) {
    // The chunks are the engine's; only the result matters here.
  }
  return stream.result
}

describe('forecast', () => {
  test('weather follows the thresholds', async () => {
    expect(weatherFor(0).word).toBe('Clear')
    expect(weatherFor(24).word).toBe('Clear')
    expect(weatherFor(25).word).toBe('Cloudy')
    expect(weatherFor(49).word).toBe('Cloudy')
    expect(weatherFor(50).word).toBe('Showers')
    expect(weatherFor(74).word).toBe('Showers')
    expect(weatherFor(75).word).toBe('Storm')
    expect(weatherFor(89).word).toBe('Storm')
    expect(weatherFor(90)).toEqual({ icon: '↯', word: 'Compact soon', color: 'red' })
    expect(weatherFor(100).color).toBe('red')
  })

  test('tokens read like 134.4k / 200k', async () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(134_400)).toBe('134.4k')
    expect(formatTokens(200_000)).toBe('200k')
    expect(formatTokens(98_300)).toBe('98.3k')
    expect(formatTokens(999_990)).toBe('1M')
    expect(formatTokens(1_250_000)).toBe('1.3M')
    expect(formatDelta(98_300, 'last turn')).toBe('▲ +98.3k last turn')
    expect(formatDelta(-120_000, 'this turn')).toBe('▼ -120k this turn')
    expect(tokensOf(usageOf(134_400))).toBe(134_400)
  })

  test('bars scale to the whole window', async () => {
    expect(barFor(0)).toBe('▁')
    expect(barFor(12)).toBe('▁')
    expect(barFor(50)).toBe('▅')
    expect(barFor(100)).toBe('█')
  })

  test('a turn keeps one bar, its latest reading', async () => {
    const a = sampleOf({ window: 200_000, tokens: 20_000 }, 't1')!
    const b = sampleOf({ window: 200_000, tokens: 36_100 }, 't1')!
    const c = sampleOf({ window: 200_000, tokens: 50_000 }, 't2')!
    expect(record(record([], a), b)).toEqual([b])
    expect(record([b], c)).toEqual([b, c])
    expect(b.percent).toBe(18)
    expect(sampleOf({ window: 200_000 }, 't1')).toBeNull()
  })

  test('measures against the auto-compact point', async () => {
    expect(compactAtOf(breakdownOf(167_000))).toBe(167_000)
    expect(compactAtOf(breakdownOf(167_000, false))).toBeNull()
    expect(compactAtOf(breakdownOf(undefined))).toBeNull()
    expect(compactAtOf(undefined)).toBeNull()
    expect(limitOf(200_000, 167_000)).toBe(167_000)
    expect(limitOf(200_000, null)).toBe(200_000)
    expect(limitOf(200_000, 250_000)).toBe(200_000)
    expect(percentOf(150_300, 167_000)).toBe(90)
    expect(percentOf(1, 0)).toBe(0)
  })

  test('rate limits read like 5h 83% ↻2h10m', async () => {
    const windows = limitsOf(RATE_LIMITS)
    expect(windows.map(w => w.kind)).toEqual(['five_hour', 'seven_day'])
    expect(windows.map(w => formatLimit(w, NOW))).toEqual(['5h 83% ↻2h10m', '7d 41% ↻3d4h'])
    expect(formatLimit({ kind: 'five_hour', percentUsed: 7 }, NOW)).toBe('5h 7%')
    expect(formatRemaining(0)).toBe('0m')
    expect(formatRemaining(-5_000)).toBe('0m')
    expect(formatRemaining(41 * 60_000 + 1)).toBe('42m')
    expect(formatRemaining(60 * 60_000)).toBe('1h00m')
    expect(formatRemaining(24 * 3_600_000)).toBe('1d0h')
    expect([10, 50, 80, 95].map(limitColor)).toEqual(['green', 'yellow', 'magenta', 'red'])
  })
})

describe('band', () => {
  test('is there from the start and moves with each response of a turn', async ($, on) => {
    let answer = 0
    let context: SessionContextUsage = { window: 200_000 }
    on('session.usage', () => ({ value: { startedAt: 0, context, rateLimits: [] } }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      const usage = usageOf(answer)
      yield { kind: 'stop', stopReason: 'tool_use', usage }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage }
    })
    on('ui.render', ($, e) => $.ui.resolve(e).Box({}))

    // Before any response the band already holds its place.
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-weather', surface, ...BAND })
      expect((await ui.find({ type: 'Text', text: /waiting/ }))?.text).toBe('☀ Clear  — / 200k  waiting for the first response')
      await ui.unmount()
    }

    await $.turn.start({ text: 'one', turnId: 't1' })
    answer = 20_000
    await step($, 't1', 0)
    answer = 36_100
    await step($, 't1', 1)
    context = { window: 200_000, tokens: 36_100, percent: 18 }
    await $.session.measure({ context, rateLimits: [], changed: ['context'] })

    await $.turn.start({ text: 'two', turnId: 't2' })
    answer = 120_000
    await step($, 't2', 0)

    // Mid-turn, after the first response of the turn.
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-weather', surface, ...WORKING })
      const line = (await ui.find({ type: 'Text', text: /Showers/ }))?.text
      expect(line).toBe('☂ Showers  60% · 120k / 200k  ▂▅  ▲ +83.9k this turn')
      await ui.unmount()
    }

    // A subagent's response is not the main window.
    answer = 190_000
    await step($, 't2', 0, 'agent-1')
    answer = 134_400
    await step($, 't2', 1)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-weather', surface, ...WORKING })
      const line = (await ui.find({ type: 'Text', text: /Showers/ }))?.text
      expect(line).toBe('☂ Showers  67% · 134.4k / 200k  ▂▆  ▲ +98.3k this turn')
      const texts = await ui.findAll({ type: 'Text', text: 'Showers' })
      expect(texts.find(t => t.text === '☂ Showers')?.props.color).toBe('blue')
      await ui.unmount()
    }

    context = { window: 200_000, tokens: 134_400, percent: 67 }
    await $.session.measure({ context, rateLimits: [], changed: ['context'] })
    const idle = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND })
    expect((await idle.find({ type: 'Text', text: /Showers/ }))?.text).toBe('☂ Showers  67% · 134.4k / 200k  ▂▆  ▲ +98.3k last turn')
    await idle.unmount()

    // A new turn with no response yet still shows the last one, as the last one.
    await $.turn.start({ text: 'three', turnId: 't3' })
    const waiting = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...WORKING })
    expect((await waiting.find({ type: 'Text', text: /Showers/ }))?.text).toContain('▲ +98.3k last turn')
    await waiting.unmount()
  })

  test('keeps the last 12 turns and starts over on /clear', async ($, on) => {
    let answer = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      const usage = usageOf(answer)
      yield { kind: 'stop', stopReason: 'end_turn', usage }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
    })
    on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))

    for (let i = 1; i <= 14; i += 1) {
      await $.turn.start({ text: '', turnId: `t${i}` })
      answer = i * 13_000
      await step($, `t${i}`, 0)
    }

    const ui = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND })
    const line = (await ui.find({ type: 'Text', text: /Compact soon/ }))?.text ?? ''
    expect(line).toContain('↯ Compact soon  91% · 182k / 200k')
    expect(line.match(/[▁▂▃▄▅▆▇█]/g)?.length).toBe(12)
    expect(line).toContain('▲ +13k last turn')
    await ui.unmount()

    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    const cleared = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND })
    expect(await cleared.find({ text: /%/ })).toBeUndefined()
    expect(await cleared.find({ text: /waiting for the first response/ })).toBeDefined()
    await cleared.unmount()
  })

  test('measures against auto-compact and shows the 5h and weekly windows', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    let answer = 0
    let context: SessionContextUsage = { window: 200_000 }
    let rateLimits: SessionRateLimit[] = []
    on('session.usage', ($, e) => ({
      value: {
        startedAt: 0,
        context: e.breakdown === undefined ? context : { ...context, breakdown: breakdownOf(167_000) },
        rateLimits,
      },
    }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      const usage = usageOf(answer)
      yield { kind: 'stop', stopReason: 'end_turn', usage }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
    })
    on('ui.render', ($, e) => $.ui.resolve(e).Box({}))

    // The start reads the compact point, before any response.
    await $.session.start({ cwd: '/', surface: null, isInteractive: true })
    const waiting = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND })
    expect((await waiting.find({ type: 'Text', text: /waiting/ }))?.text).toBe(
      '☀ Clear  — / 167k compact · 200k max  waiting for the first response',
    )
    await waiting.unmount()

    await $.turn.start({ text: 'one', turnId: 't1' })
    answer = 150_300
    await step($, 't1', 0)
    context = { window: 200_000, tokens: 150_300, percent: 75 }
    rateLimits = RATE_LIMITS
    await $.session.measure({ context, rateLimits, changed: ['context', 'rateLimits'] })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'token-weather', surface, ...BAND })
      const line = (await ui.find({ type: 'Text', text: /Compact soon/ }))?.text
      expect(line).toBe('↯ Compact soon  90% · 150.3k / 167k compact · 200k max  █  5h 83% ↻2h10m  7d 41% ↻3d4h')
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.find(t => t.text === '5h 83% ↻2h10m')?.props.color).toBe('magenta')
      expect(texts.find(t => t.text === '7d 41% ↻3d4h')?.props.color).toBe('green')
      await ui.unmount()
    }

    // The countdown follows the clock.
    await clock.advance(60 * 60_000)
    const later = await $.ui.mount({ plugin: 'token-weather', surface: 'terminal', ...BAND })
    expect((await later.find({ type: 'Text', text: /Compact soon/ }))?.text).toContain('5h 83% ↻1h10m  7d 41% ↻3d3h')
    await later.unmount()
  })
})
