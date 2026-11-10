// One reading of the main window, tagged with the turn it was taken in.
export type Sample = { turnId: string; tokens: number; window: number; percent: number }

// One rate-limit window: `five_hour` or `seven_day`, how much is used, and when it resets.
// The main loop's model as its requests name it, and the effort they ask for (null: none).
export type Engine = { model: string; effort: string | null }

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'token-weather': {
      samples: Sample[]
      turn: string | null
      // The token count auto-compaction runs at, or null while unknown or switched off.
      compactAt: number | null
      limits: Limit[]
      // The model and effort of the main loop's latest request; null before the first.
      engine: Engine | null
    }
  }
}
