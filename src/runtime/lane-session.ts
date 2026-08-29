/**
 * Stable Companion lane identities and live SessionStore resolution.
 *
 * Runtime owns only the lane-to-id contract. AgentLoop owns materialization
 * and lifecycle; SessionStore remains the single live registry and collision
 * boundary. No Session object is cached or mirrored here.
 */
import { SessionId, type Session, type SessionStore } from '@deepseek-ai/dsh-session'
import type { Lane } from '../contracts/focus.js'

/** The two Runtime-owned lanes, used internally during plugin materialization. */
export const COMPANION_LANES = ['work', 'go'] as const satisfies readonly Lane[]

const LANE_SESSION_IDS: Readonly<Record<Lane, SessionId>> = Object.freeze({
  work: SessionId('companion-go-work'),
  go: SessionId('companion-go-go'),
})

/** Return the stable exact Session identity assigned to a lane. */
export function laneSessionId(lane: Lane): SessionId {
  return LANE_SESSION_IDS[lane]
}

/** Resolve the lane's current live Session directly from the owning store. */
export function resolveLaneSession(
  sessions: Pick<SessionStore, 'get'>,
  lane: Lane,
): Session | undefined {
  return sessions.get(laneSessionId(lane))
}
