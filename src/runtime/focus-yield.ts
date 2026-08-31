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
 * The narrow handle returned to the focus-submission call site. It exposes
 * exactly one A-T04-owned reconciliation action and owns no state itself.
 */
export type FocusYieldBinding = Readonly<{
  /**
   * Reconcile the current active lane after a focus submission when the
   * active Agent is already idle. It resolves without switching when there
   * is no eligible cross-lane handoff or the Agent is not idle; the observed
   * `agent/status: idle` path keeps covering a still-running Agent.
   */
  reconcileCurrentEligibility: () => Promise<void>
}>

/**
 * Bind the verified pinned-DSH continuation yield and post-settle lane switch.
 *
 * RuntimeFocusOwner remains the sole state owner. This binding consumes its
 * A-T03 eligibility, restores the exact already-claimed batch before rejecting
 * continuation, confirms real Agent quiescence, and only then activates the
 * authoritative pending target. It does not wake either lane or consume the
 * pending focus intent.
 *
 * Settle reconciliation is shared by two entry points: the observed
 * `agent/status: idle` transition (focus pending while running), and the
 * returned `reconcileCurrentEligibility` action (focus submitted while the
 * active Agent is already idle, so no further idle transition may arrive).
 */
export function bindPinnedDshCooperativeYield(
  ctx: Context,
  owner: RuntimeFocusOwner,
  agents: PairedLaneAgents,
  options: FocusYieldBindingOptions = {},
): FocusYieldBinding {
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

    await reconcileEligibleFocus(owner, agent, lane, settle, options)
  })

  return {
    reconcileCurrentEligibility: async () => {
      const lane = owner.state.activeLane
      const agent = agents[lane]
      if (agent.status !== 'idle') return
      await reconcileEligibleFocus(owner, agent, lane, 'natural', options)
    },
  }
}

/**
 * The one settle-reconciliation seam shared by both entry points.
 *
 * It requires an eligible cross-lane pending focus and an idle active Agent,
 * confirms quiescence through the real `whenIdle`, revalidates every settled
 * condition after the await, rereads the authoritative winning intent inside
 * the owner, and activates it through the existing confirmed-settle switch —
 * emitting switch observability exactly once. It creates no state, queue,
 * timer, or event of its own.
 */
async function reconcileEligibleFocus(
  owner: RuntimeFocusOwner,
  agent: Agent,
  lane: Lane,
  settle: FocusSettleKind,
  options: FocusYieldBindingOptions,
): Promise<void> {
  if (owner.eligibleHandoff === undefined) return
  if (agent.status !== 'idle') return

  await agent.whenIdle()

  if (owner.state.activeLane !== lane) return
  if (agent.status !== 'idle') return
  if (owner.executingStep !== undefined || owner.state.llmRunning) return
  if (owner.eligibleHandoff === undefined) return

  options.onSettleConfirmed?.({ lane, settle })
  const transition = owner.switchAfterConfirmedSettle(lane, settle)
  if (transition !== undefined) options.onLaneSwitch?.(transition)
}

function laneForAgent(agents: PairedLaneAgents, agent: Agent): Lane | undefined {
  if (agents.work === agent) return 'work'
  if (agents.go === agent) return 'go'
  return undefined
}
