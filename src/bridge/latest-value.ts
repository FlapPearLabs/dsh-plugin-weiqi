/**
 * One latest-value slot.
 *
 * A slot retains exactly the newest published value and the sequence of the
 * authoritative fact that produced it. Superseded values are dropped rather
 * than stored, so this is not a queue and has no history to replay.
 */
export type PublishOutcome = 'published' | 'stale'

/** Reject sequences that cannot order two authoritative facts. */
function assertSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError(
      `sequence must be a non-negative safe integer, received ${String(sequence)}`,
    )
  }
}

export class LatestValueSlot<T> {
  #published: { readonly value: T; readonly sequence: number } | undefined

  /** The newest published value, or `undefined` before the first publication. */
  get value(): T | undefined {
    return this.#published?.value
  }

  /** Sequence of the retained value, or `undefined` before the first publication. */
  get sequence(): number | undefined {
    return this.#published?.sequence
  }

  /**
   * Publish one already-computed value.
   *
   * A sequence at or below the retained one is stale and changes nothing:
   * out-of-order source updates never resurrect an older value.
   */
  publish(value: T, sequence: number): PublishOutcome {
    assertSequence(sequence)

    if (this.#published !== undefined && sequence <= this.#published.sequence) {
      return 'stale'
    }

    this.#published = { value, sequence }
    return 'published'
  }
}
