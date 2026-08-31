import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Lane } from '../contracts/focus.js'
import {
  type PairedLaneAgents,
  type RuntimeFocusOwner,
  type SettledFocusSwitch,
} from './focus-boundary.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The one post-settle lane switch already committed by the A-T04 yield
     * binding. Emitted by the composition root; consumed by the A-T07 resume
     * binding. `mode: emit` — synchronous, fire-and-forget.
     */
    'focus/lane-switched'(transition: SettledFocusSwitch): void
  }
}

/**
 * Exactly one plugin-sourced steering resume for a deliberately paused lane.
 * This is the verified pinned-DSH external resume seam (A-T07 / BL-RT-11):
 * after the post-settle switch back, steering wakes the paused driver and the
 * preserved next-step batch is claimed in stored order before the resume
 * message — producing the verified ordering `A → B → C → companion-resume`.
 */
export const COMPANION_RESUME_PLUGIN = 'companion-go-resume'

/** Executable observability for A-T07 tests; it carries no independent state. */
export type FocusResumeBindingOptions = Readonly<{
  /** Fired when focus returns to a deliberately paused lane (admission point). */
  onResumeAdmitted?: (event: Readonly<{
    lane: Lane
    syntheticResume: boolean
  }>) => void
  /** Fired when the exactly-one synthetic companion-resume message is built. */
  onCompanionResumeCreated?: (message: UserMessage) => void
  /** Fired after the synthetic resume was handed to the verified `steer` seam. */
  onResumeSent?: (event: Readonly<{
    lane: Lane
    messageId: UserMessage['id']
  }>) => void
}>

/**
 * The narrow handle A-T07 adds beside the A-T04 binding; it owns no state.
 *
 * `admitResume` is the single admission action for the one committed switch
 * that resumed the paused lane (`transition.resumedLane`, set atomically by
 * the owner). It decides whether the lane's real wake already exists and,
 * only when it does not, emits exactly one plugin-sourced companion-resume
 * through the verified `agent.steer()` seam. The pause marker and the winning
 * pending intent were already consumed inside `switchAfterConfirmedSettle`
 * (the immutable intent survives via the transition), so no second admission
 * can exist for one pause cycle.
 */
export type FocusResumeBinding = Readonly<{
  admitResume: (transition: SettledFocusSwitch) => void
}>

/**
 * Bind the A-T07 production resume sequencing to the real pinned DSH lifecycle.
 *
 * RuntimeFocusOwner remains the sole state owner. This binding observes the
 * A-T04 post-settle switch through `focus/lane-switched`; only the switch
 * that resumed the deliberately paused lane reaches the resume decision. The
 * synthetic resume wakes the resumed driver so the preserved continuation —
 * whether or not it still carries an inbox batch — is claimed at the next
 * step boundary. It is suppressed only when a REAL user wake already exists:
 * a running driver, or a user-origin message already parked in the lane's
 * inbox that will wake/drive it. Merely storing a `sourceMessage` inside the
 * winning intent is not a wake: it proves the immutable user message exists
 * and must be preserved, but not that the target Agent received it, entered
 * nextTurn/nextStep, or became non-idle. Likewise the preserved batch length
 * is not evidence of consumption: a deliberately yielded continuation can
 * carry an empty inbox batch (durable tool results still require another
 * model step), so the pausedLane marker itself is the authoritative fact.
 * Natural settlements never pause a lane, so they never reach this path.
 * The whole path is synchronous and creates no queue, timer, mailbox, or
 * event of its own.
 */
export function bindPinnedDshLaneResume(
  ctx: Context,
  owner: RuntimeFocusOwner,
  agents: PairedLaneAgents,
  options: FocusResumeBindingOptions = {},
): FocusResumeBinding {
  const admitResume = (transition: SettledFocusSwitch): void => {
    const lane = transition.resumedLane
    if (lane === undefined || lane !== transition.to) return
    if (owner.state.activeLane !== lane) return

    const agent = agents[lane]
    // Only an actual wake signal suppresses the synthetic resume: the lane's
    // driver already runs, or a user-origin message already sits in the lane's
    // inbox and will wake/drive it. `transition.intent.sourceMessage` alone is
    // NOT such a signal (P1-1); it remains preserved via the transition for
    // the delivery path owned by later Tickets.
    const realUserWake = agent.status !== 'idle'
      || hasUserWake(agent)
    // The deliberately paused lane needs resume admission regardless of the
    // preserved batch length (P1-2): an empty nextStep is a normal
    // tool-results continuation, not evidence the pause was consumed.
    const syntheticResume = !realUserWake

    options.onResumeAdmitted?.({ lane, syntheticResume })
    if (!syntheticResume) return

    const resume = createUserMessage({
      content: [{ type: 'text', text: 'companion-resume' }],
      source: { kind: 'plugin', plugin: COMPANION_RESUME_PLUGIN },
    })
    options.onCompanionResumeCreated?.(resume)
    agent.steer(resume)
    options.onResumeSent?.({ lane, messageId: resume.id })
  }

  ctx.on('focus/lane-switched', transition => {
    admitResume(transition)
  })

  return { admitResume }
}

/** Whether any pending waking input in the lane's inbox came from the user. */
function hasUserWake(agent: Agent): boolean {
  const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
  return pending.some(message => message.source.kind === 'user')
}

/**
 * Emit the one post-settle switch event this binding observes.
 *
 * The A-T04 yield binding's caller passes `onLaneSwitch` through to this, so
 * A-T07 stays a pure consumer of the already-verified transition without
 * re-deriving settle kind or re-reading owner state at a second site.
 */
export function emitLaneSwitched(ctx: Context, transition: SettledFocusSwitch): void {
  ctx.emit('focus/lane-switched', transition)
}
