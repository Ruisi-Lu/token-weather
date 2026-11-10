import type { ModelUsage, SessionContextBreakdown, SessionRateLimit } from 'claude-code'

import type { Limit, Sample } from '../types'

export type Weather = { icon: string; word: string; color: string }

// How many turns the chart keeps.
export const HISTORY = 12

const BARS = '▁▂▃▄▅▆▇█'

export function weatherFor(percent: number): Weather {
  if (percent < 25) return { icon: '☀', word: 'Clear', color: 'yellow' }
  if (percent < 50) return { icon: '☁', word: 'Cloudy', color: 'cyan' }
  if (percent < 75) return { icon: '☂', word: 'Showers', color: 'blue' }
  if (percent < 90) return { icon: '☇', word: 'Storm', color: 'magenta' }
  return { icon: '↯', word: 'Compact soon', color: 'red' }
}

// One decimal, dropping a trailing ".0": 134400 -> "134.4k", 200000 -> "200k".
export function formatTokens(tokens: number): string {
  const n = Math.abs(Math.round(tokens))
  if (n < 1000) return String(n)
  const thousands = Math.round(n / 100) / 10
  if (thousands < 1000) return `${trim(thousands)}k`
  return `${trim(Math.round(n / 100_000) / 10)}M`
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

// Bars against the whole window, so a full bar means a full window.
export function barFor(percent: number): string {
  const level = Math.min(BARS.length - 1, Math.max(0, Math.floor(percent / (100 / BARS.length))))
  return BARS.charAt(level)
}

export function formatDelta(delta: number, span: string): string {
  return delta < 0 ? `▼ -${formatTokens(delta)} ${span}` : `▲ +${formatTokens(delta)} ${span}`
}

// The window a response was answered over: uncached, cache-written and cache-read input together.
export function tokensOf(usage: ModelUsage): number {
  return usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
}

export function sampleOf(
  context: { tokens?: number; window: number; percent?: number },
  turnId: string,
): Sample | null {
  if (context.tokens === undefined || context.window <= 0) return null
  const percent = context.percent ?? Math.round((context.tokens / context.window) * 100)
  return { turnId, tokens: context.tokens, window: context.window, percent }
}

// One bar per turn: a reading from the turn the last bar belongs to replaces it.
export function record(list: readonly Sample[], sample: Sample): Sample[] {
  const kept = list.at(-1)?.turnId === sample.turnId ? list.slice(0, -1) : list
  return [...kept, sample].slice(-HISTORY)
}

// The token count auto-compaction runs at, or null when it is off or not reported.
export function compactAtOf(breakdown: SessionContextBreakdown | undefined): number | null {
  if (breakdown === undefined || !breakdown.isAutoCompactEnabled) return null
  const at = breakdown.autoCompactThreshold
  return at !== undefined && at > 0 ? at : null
}

// What the weather and bars measure against: the auto-compact point when it comes before the window's end.
export function limitOf(window: number, compactAt: number | null): number {
  return compactAt !== null && compactAt < window ? compactAt : window
}

export function percentOf(tokens: number, limit: number): number {
  return limit > 0 ? Math.round((tokens / limit) * 100) : 0
}

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

// The five-hour and weekly windows, in that order; other kinds are left out.
export function limitsOf(rateLimits: readonly SessionRateLimit[]): Limit[] {
  return Object.keys(LIMIT_LABELS).flatMap(kind => {
    const found = rateLimits.find(limit => limit.kind === kind)
    if (found === undefined) return []
    return [found.resetsAt === undefined
      ? { kind, percentUsed: found.percentUsed }
      : { kind, percentUsed: found.percentUsed, resetsAt: found.resetsAt }]
  })
}

// Quiet while there is room; colored once a window is past half.
export function limitColor(percentUsed: number): string | undefined {
  if (percentUsed < 50) return undefined
  if (percentUsed < 80) return 'yellow'
  if (percentUsed < 95) return 'magenta'
  return 'red'
}

const METER_CELLS = 5

// A five-cell meter, one cell to each fifth used: 83% -> "▰▰▰▰▱".
export function meterFor(percentUsed: number): string {
  const filled = Math.min(METER_CELLS, Math.max(0, Math.round(percentUsed / (100 / METER_CELLS))))
  return '▰'.repeat(filled) + '▱'.repeat(METER_CELLS - filled)
}

// Time left until a reset, to the minute: "42m", "2h10m", "3d4h".
export function formatRemaining(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

export type LimitParts = { label: string; meter: string; used: string; resets?: string }

// "5h ▰▰▰▰▱ 83% · resets 2h10m", in parts so the meter can carry its own color.
export function limitParts(limit: Limit, now: number): LimitParts {
  const parts = {
    label: LIMIT_LABELS[limit.kind] ?? limit.kind,
    meter: meterFor(limit.percentUsed),
    used: `${Math.round(limit.percentUsed)}%`,
  }
  const resetsAt = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)
  return Number.isNaN(resetsAt) ? parts : { ...parts, resets: formatRemaining(resetsAt - now) }
}

export function formatLimit(limit: Limit, now: number): string {
  const { label, meter, used, resets } = limitParts(limit, now)
  return `${label} ${meter} ${used}${resets === undefined ? '' : ` · resets ${resets}`}`
}

const FAMILIES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }

// "claude-opus-5-5" -> "Opus 5.5", "claude-sonnet-5-5-20261001[1m]" -> "Sonnet 5.5 1M"; anything else as it is.
export function modelName(id: string): string {
  const match = /^(?:claude-)?([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id.trim())
  const family = match?.[1] === undefined ? undefined : FAMILIES[match[1].toLowerCase()]
  if (match === null || family === undefined) return id
  const version = match[3] === undefined ? match[2] : `${match[2]}.${match[3]}`
  return `${family} ${version}${match[4] === undefined ? '' : ' 1M'}`
}

// A numeric effort reads as its number; none, as nothing.
export function effortOf(effort: string | number | undefined): string | null {
  return effort === undefined ? null : String(effort)
}
