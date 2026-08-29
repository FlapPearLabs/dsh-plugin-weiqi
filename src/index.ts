/** Companion Go's named Cordis function-plugin entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { COMPANION_LANES, laneSessionId } from './runtime/lane-session.js'

export * from './contracts/index.js'

/** Cordis plugin name used by DSH Loader diagnostics. */
export const name = 'companion-go'

/** AgentRegistry delegates real Agent/Session creation to the active AgentLoop. */
export const inject = ['agents'] as const

/** Foundation config remains intentionally empty. */
export interface Config {}

/**
 * Materialize the two stable lane identities through AgentLoop's public
 * factory boundary. Each returned handle is structurally owned by this
 * plugin's calling fiber, so Cordis rollback/disposal tears down both the
 * Agent and its Session without a second lifecycle registry here.
 */
export async function apply(ctx: Context, _config: Config = {}): Promise<void> {
  for (const lane of COMPANION_LANES) {
    await ctx.agents.create({ sessionId: laneSessionId(lane) })
  }
}
