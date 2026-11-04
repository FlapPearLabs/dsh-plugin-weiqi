import type { CompanionState } from '../contracts/companion.js'

export type CompanionStateUpdate<
  TCompiledPersona = unknown,
  TMoodState = unknown,
> = Partial<CompanionState<TCompiledPersona, TMoodState>>

/** Latest-wins holder; updates replace fields rather than applying deltas. */
export class CompanionStateHolder<TCompiledPersona = unknown, TMoodState = unknown> {
  #state: CompanionState<TCompiledPersona, TMoodState>

  constructor(initial: CompanionState<TCompiledPersona, TMoodState>) {
    this.#state = initial
  }

  get current(): CompanionState<TCompiledPersona, TMoodState> {
    return this.#state
  }

  update(patch: CompanionStateUpdate<TCompiledPersona, TMoodState>): CompanionState<TCompiledPersona, TMoodState> {
    this.#state = { ...this.#state, ...patch }
    return this.#state
  }
}
