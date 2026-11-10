// One reading of the main window, tagged with the turn it was taken in.
export type Sample = { turnId: string; tokens: number; window: number; percent: number }

// One rate-limit window: `five_hour` or `seven_day`, how much is used, and when it resets.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'token-weather': {
      samples: Sample[]
      turn: string | null
      // The token count auto-compaction runs at, or null while unknown or switched off.
      compactAt: number | null
      limits: Limit[]
    }
  }
}
