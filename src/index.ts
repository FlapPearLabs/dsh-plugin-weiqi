/**
 * Companion Go's DeepSeek Harness plugin entry.
 *
 * Foundation deliberately registers no Runtime, tools, UI, or game engine.
 * Later phases extend this real Cordis/DSH entry without changing the frozen
 * public contracts established in `src/contracts`.
 */
import type { Context } from '@deepseek-ai/cordis'

export * from './contracts/index.js'

/** Cordis plugin name used by DSH loader diagnostics. */
export const name = 'companion-go'

/** Foundation config is intentionally empty until an implementation ticket freezes options. */
export interface Config {}

/**
 * Mount the Companion Go plugin.
 *
 * The Foundation stage is a lifecycle-safe no-op: it proves the package is a
 * genuine DSH/Cordis plugin while avoiding any unapproved Runtime behavior.
 */
export function apply(_ctx: Context, _config: Config = {}): void {}
