/** Attention modes frozen by the verified R2.4 architecture. */
export type AttentionMode = 'mofish' | 'normal' | 'strict' | 'manual'

/**
 * Shared authoritative Companion state.
 *
 * Persona and mood shapes remain generic because R2.4 freezes their ownership
 * but intentionally does not freeze their internal schemas yet.
 */
export type CompanionState<TCompiledPersona = unknown, TMoodState = unknown> = {
  persona: TCompiledPersona
  mood: TMoodState
  attentionMode: AttentionMode
  variationSeed: string
}
