import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type {
  Lane,
  PendingFocusIntent,
  RuntimeFocusState,
} from '../contracts/focus.js'
import {
  activateLane,
  admitPausedLaneResume,
  createRuntimeFocusState,
  markLanePaused,
  setLlmRunning,
  submitFocusIntent,
  type FocusIntentDisposition,
} from './focus.js'

/** The one real DSH step currently executing in the foreground lane. */
export type ExecutingStep = Readonly<{
  lane: Lane
  turn: number
  step: number
}>

/** A boundary at which no already-started model or tool work is in flight. */
export type SafeHandoffBoundary =
  | Readonly<{
    /** No observed DSH step is executing; this does not assert Agent idle/settled. */
    kind: 'no-step'
  }>
  | Readonly<{
    kind: 'step-end'
    lane: Lane
    turn: number
    step: number
  }>

/** One pending focus transition that became eligible at a safe boundary. */
export type EligibleFocusHandoff = Readonly<{
  from: Lane
  to: Lane
  intent: PendingFocusIntent
  boundary: SafeHandoffBoundary
}>

/** Result of submitting one intent to the A-T02 single-slot machine. */
export type FocusIntentSubmission = Readonly<{
  disposition: FocusIntentDisposition
  eligibility?: EligibleFocusHandoff
}>

/** The real Agent settlement path that authorized one active-lane switch. */
export type FocusSettleKind = 'natural' | 'cooperative-yield'

/** One post-settle switch using the winning A-T02 pending intent. */
export type SettledFocusSwitch = Readonly<{
  from: Lane
  to: Lane
  intent: PendingFocusIntent
  settle: FocusSettleKind
  /**
   * A-T07: present only when this switch resumed the deliberately paused
   * lane — the pause marker was consumed at this exact admission point
   * through the frozen A-T02 primitive before the switch completed.
   */
  resumedLane?: Lane
}>

/** The exact Work/Go agents whose real DSH lifecycle this owner observes. */
export type PairedLaneAgents = Readonly<Record<Lane, Agent>>

/** Narrow observability for the committed boundary; not a wake or yield path. */
export type FocusBoundaryBindingOptions = Readonly<{
  onEligibility?: (eligibility: EligibleFocusHandoff) => void
}>

/**
 * Sole mutable owner of RuntimeFocusState and its real-step execution marker.
 *
 * A-T03 only reports that a pending lane transition is eligible after the
 * current step has committed. It leaves activeLane and the winning pendingFocus
 * intact for the later yield/switch Tickets and contains no yield sequence.
 */
export class RuntimeFocusOwner {
  private focusState: RuntimeFocusState
  private currentStep: ExecutingStep | undefined

  constructor(activeLane: Lane = 'work') {
    this.focusState = createRuntimeFocusState(activeLane)
  }

  /** Current A-T02 focus state; this object is replaced, never mutated in place. */
  get state(): RuntimeFocusState {
    return this.focusState
  }

  /** Current real DSH step, or undefined when no observed step is executing. */
  get executingStep(): ExecutingStep | undefined {
    return this.currentStep
  }

  /** Current A-T03 eligibility, without inferring that the Agent is settled. */
  get eligibleHandoff(): EligibleFocusHandoff | undefined {
    if (this.currentStep !== undefined || this.focusState.llmRunning) return undefined
    return this.eligiblePendingAt({ kind: 'no-step' })
  }

  /** Arbitrate one intent, reporting eligibility when no step/model is observed. */
  submitFocusIntent(intent: PendingFocusIntent): FocusIntentSubmission {
    const transition = submitFocusIntent(this.focusState, intent)
    this.focusState = transition.state
    const eligibility = this.eligibleHandoff
    return {
      disposition: transition.disposition,
      ...eligibility === undefined ? {} : { eligibility },
    }
  }

  /** Observe the committed `step/start` for the sole active lane. */
  stepStarted(lane: Lane, turn: number, step: number): void {
    if (this.currentStep !== undefined) {
      throw new Error(
        `cannot start ${lane} ${turn}/${step}: already executing `
        + `${this.currentStep.lane} ${this.currentStep.turn}/${this.currentStep.step}`,
      )
    }
    if (lane !== this.focusState.activeLane) {
      throw new Error(`step lane ${lane} does not match active lane ${this.focusState.activeLane}`)
    }
    this.currentStep = Object.freeze({ lane, turn, step })
  }

  /** Observe entry into the actual model stream for the current DSH step. */
  modelRequestStarted(lane: Lane): void {
    this.assertExecutingLane(lane)
    this.focusState = setLlmRunning(this.focusState, true)
  }

  /** Observe settlement of the actual model stream; tool work may follow. */
  modelRequestSettled(lane: Lane): void {
    this.assertExecutingLane(lane)
    this.focusState = setLlmRunning(this.focusState, false)
  }

  /**
   * Observe committed `step/end`, then report the eligible handoff.
   * Pinned AgentLoop emits this only after every requested tool result commits.
   */
  stepCommitted(lane: Lane, turn: number, step: number): EligibleFocusHandoff | undefined {
    const current = this.currentStep
    if (
      current === undefined
      || current.lane !== lane
      || current.turn !== turn
      || current.step !== step
    ) {
      const actual = current === undefined
        ? 'no executing step'
        : `${current.lane} ${current.turn}/${current.step}`
      throw new Error(`committed step ${lane} ${turn}/${step} does not match ${actual}`)
    }
    if (this.focusState.llmRunning) {
      throw new Error(`cannot commit step ${lane} ${turn}/${step}: model is still running`)
    }

    this.currentStep = undefined
    return this.eligiblePendingAt({ kind: 'step-end', lane, turn, step })
  }

  /**
   * Switch only after the binding has confirmed the active Agent is truly idle.
   * The winning pending intent remains present for the later admission/wake path.
   *
   * A-T07: when the winning target is the deliberately paused lane, this
   * switch IS the resume admission — the pause marker is consumed through the
   * frozen A-T02 primitive BEFORE any cooperative-yield marker is recorded,
   * so a cooperative return re-marks the yielding lane without displacing the
   * resumed lane's admission. The switch reports `resumedLane` exactly once.
   */
  switchAfterConfirmedSettle(
    lane: Lane,
    settle: FocusSettleKind,
  ): SettledFocusSwitch | undefined {
    if (lane !== this.focusState.activeLane) return undefined
    if (this.currentStep !== undefined || this.focusState.llmRunning) {
      throw new Error(`cannot switch lane ${lane}: active Agent work is not settled`)
    }

    const intent = this.focusState.pendingFocus
    if (intent === undefined || intent.target === lane) return undefined

    const from = lane
    const resumedLane = this.focusState.pausedLane === intent.target
      ? intent.target
      : undefined
    if (resumedLane !== undefined) {
      this.focusState = admitPausedLaneResume(this.focusState)
    }
    if (settle === 'cooperative-yield') {
      this.focusState = markLanePaused(this.focusState, from)
    }
    this.focusState = activateLane(this.focusState, intent.target)

    return Object.freeze({
      from,
      to: intent.target,
      intent,
      settle,
      ...(resumedLane === undefined ? {} : { resumedLane }),
    })
  }

  /**
   * Admit the deliberately paused lane back to foreground state through the
   * frozen A-T02 pure primitive: `pausedLane` is consumed and `activeLane`
   * becomes the paused lane in one replacement. This is the single admission
   * point A-T07's resume sequencing calls; it is a no-op without a pause
   * marker and never touches pendingFocus.
   */
  admitPausedLaneResume(): RuntimeFocusState {
    this.focusState = admitPausedLaneResume(this.focusState)
    return this.focusState
  }

  private assertExecutingLane(lane: Lane): void {
    if (this.currentStep?.lane !== lane) {
      const actual = this.currentStep?.lane ?? 'none'
      throw new Error(`model lane ${lane} does not match executing lane ${actual}`)
    }
  }

  private eligiblePendingAt(boundary: SafeHandoffBoundary): EligibleFocusHandoff | undefined {
    const intent = this.focusState.pendingFocus
    if (intent === undefined || intent.target === this.focusState.activeLane) return undefined

    const from = this.focusState.activeLane
    return Object.freeze({ from, to: intent.target, intent, boundary })
  }
}

/**
 * Bind one RuntimeFocusOwner to the real pinned DSH lifecycle.
 *
 * `session/event` supplies committed step boundaries. `llm/stream` wraps the
 * actual adapter stream, so llmRunning covers generation rather than merely
 * the earlier `agent/request` configuration waterfall. This binding observes
 * only committed session events and model streams; it performs no
 * continuation interception or wake.
 */
export function bindPinnedDshFocusBoundary(
  ctx: Context,
  owner: RuntimeFocusOwner,
  agents: PairedLaneAgents,
  options: FocusBoundaryBindingOptions = {},
): void {
  ctx.on('session/event', (session, event) => {
    const lane = laneForSession(agents, session)
    if (lane === undefined) return

    if (event.type === 'step/start') {
      owner.stepStarted(lane, event.data.turn, event.data.step)
      return
    }
    if (event.type !== 'step/end') return

    const eligibility = owner.stepCommitted(lane, event.data.turn, event.data.step)
    if (eligibility !== undefined) options.onEligibility?.(eligibility)
  })

  ctx.on('llm/stream', (request: GenerateOptions, next) => {
    if (request.sessionId === undefined || request.purpose !== undefined) return next()
    const lane = laneForSessionId(agents, request.sessionId)
    if (lane === undefined) return next()
    return trackModelStream(owner, lane, next)
  })
}

function laneForSession(agents: PairedLaneAgents, session: Session): Lane | undefined {
  if (agents.work.session === session) return 'work'
  if (agents.go.session === session) return 'go'
  return undefined
}

function laneForSessionId(
  agents: PairedLaneAgents,
  sessionId: GenerateOptions['sessionId'],
): Lane | undefined {
  if (agents.work.session.id === sessionId) return 'work'
  if (agents.go.session.id === sessionId) return 'go'
  return undefined
}

function trackModelStream(
  owner: RuntimeFocusOwner,
  lane: Lane,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  return (async function* () {
    owner.modelRequestStarted(lane)
    try {
      yield* next()
    } finally {
      owner.modelRequestSettled(lane)
    }
  })()
}
