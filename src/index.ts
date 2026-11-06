/** Companion Go's named Cordis function-plugin entry. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Lane } from './contracts/focus.js'
import { COMPANION_LANES, laneSessionId } from './runtime/lane-session.js'
import { RuntimeFocusOwner, bindPinnedDshFocusBoundary } from './runtime/focus-boundary.js'
import { bindPinnedDshCooperativeYield } from './runtime/focus-yield.js'
import { bindPinnedDshLaneResume, emitLaneSwitched } from './runtime/focus-resume.js'
import { composeGoLaneScope } from './runtime/go-capability-guard.js'
import { GO_PRESET_ID } from './preset/go-preset.js'
import { BridgeRuntime } from './bridge/runtime.js'
import { CrossLaneAwareness } from './bridge/awareness.js'
import { bindBridgeDelivery } from './bridge/delivery.js'

export * from './contracts/index.js'

/** Cordis plugin name used by DSH Loader diagnostics. */
export const name = 'companion-go'

/** AgentRegistry delegates real Agent/Session creation to the active AgentLoop. */
export const inject = ['agents', 'llm'] as const

/** Foundation config remains intentionally empty. */
export interface Config {}

/**
 * Materialize the two stable lane identities through AgentLoop's public
 * factory boundary. Each returned handle is structurally owned by this
 * plugin's calling fiber, so Cordis rollback/disposal tears down both the
 * Agent and its Session without a second lifecycle registry here.
 */
export async function apply(ctx: Context, _config: Config = {}): Promise<void> {
  const agents = {} as Record<Lane, Agent>
  for (const lane of COMPANION_LANES) {
    agents[lane] = (
      await ctx.agents.create({
        sessionId: laneSessionId(lane),
        // Only the isolated Go lane is composed from the native-only preset.
        // The durable `agentPreset` header is written together with the setup
        // that actually composes the scoped world (the guard bound as the
        // agent's `goCapabilities` service), never as a bare label.
        ...(lane === 'go'
          ? {
              meta: { agentPreset: GO_PRESET_ID },
              setup: composeGoLaneScope,
            }
          : {}),
      })
    ).agent
  }

  const focusOwner = new RuntimeFocusOwner('work')
  bindBridgeDelivery(
    { go: agents.go.ctx.systemPrompt, work: agents.work.ctx.systemPrompt },
    new CrossLaneAwareness(new BridgeRuntime()),
  )
  bindPinnedDshFocusBoundary(ctx, focusOwner, agents)
  bindPinnedDshCooperativeYield(ctx, focusOwner, agents, {
    onLaneSwitch: transition => emitLaneSwitched(ctx, transition),
  })
  bindPinnedDshLaneResume(ctx, focusOwner, agents)
}
