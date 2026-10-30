import type { ModelUsage } from 'claude-code'

import type { Sample } from '../types'

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
