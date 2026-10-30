// One reading of the main window, tagged with the turn it was taken in.
export type Sample = { turnId: string; tokens: number; window: number; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'token-weather': { samples: Sample[]; turn: string | null }
  }
}
