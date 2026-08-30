import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Lane } from '../contracts/focus.js'
import {
  type FocusSettleKind,
  type PairedLaneAgents,
  type RuntimeFocusOwner,
  type SettledFocusSwitch,
} from './focus-boundary.js'

/** Executable observability for A-T04 tests; it carries no independent state. */
export type FocusYieldBindingOptions = Readonly<{
  onBatchRestored?: (event: Readonly<{
    lane: Lane
    claimed: readonly UserMessage[]
    restored: readonly UserMessage[]
  }>) => void
  onSettleConfirmed?: (event: Readonly<{
    lane: Lane
    settle: FocusSettleKind
  }>) => void
  onLaneSwitch?: (transition: SettledFocusSwitch) => void
}>

/**
 * Bind the verified pinned-DSH continuation yield and post-settle lane switch.
 *
 * RuntimeFocusOwner remains the sole state owner. This binding consumes its
 * A-T03 eligibility, restores the exact already-claimed batch before rejecting
 * continuation, confirms real Agent quiescence, and only then activates the
 * authoritative pending target. It does not wake either lane or consume the
 * pending focus intent.
 */
export function bindPinnedDshCooperativeYield(
  ctx: Context,
  owner: RuntimeFocusOwner,
  agents: PairedLaneAgents,
  options: FocusYieldBindingOptions = {},
): void {
  let yieldedAgent: Agent | undefined

  ctx.on('agent/pre-step', async (payload, next) => {
    const lane = laneForAgent(agents, payload.agent)
    if (lane === undefined || payload.agent !== agents[owner.state.activeLane]) return next()

    const eligibility = owner.eligibleHandoff
    if (eligibility === undefined || eligibility.from !== lane) return next()

    payload.agent.inbox.splice('next-step', 0, 0, payload.messages)
    yieldedAgent = payload.agent
    options.onBatchRestored?.({
      lane,
      claimed: payload.messages,
      restored: payload.agent.inbox.nextStep,
    })
    return { kind: 'reject' }
  })

  ctx.on('agent/status', async ({ agent, status }) => {
    if (status !== 'idle') return
    const lane = laneForAgent(agents, agent)
    if (lane === undefined || lane !== owner.state.activeLane) return

    const settle: FocusSettleKind = yieldedAgent === agent
      ? 'cooperative-yield'
      : 'natural'
    if (yieldedAgent === agent) yieldedAgent = undefined
    if (owner.eligibleHandoff === undefined) return

    await agent.whenIdle()
    if (agent.status !== 'idle' || owner.eligibleHandoff === undefined) return

    options.onSettleConfirmed?.({ lane, settle })
    const transition = owner.switchAfterConfirmedSettle(lane, settle)
    if (transition !== undefined) options.onLaneSwitch?.(transition)
  })
}

function laneForAgent(agents: PairedLaneAgents, agent: Agent): Lane | undefined {
  if (agents.work === agent) return 'work'
  if (agents.go === agent) return 'go'
  return undefined
}
