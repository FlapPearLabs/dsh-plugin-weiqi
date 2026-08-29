import { Session, SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { laneSessionId, resolveLaneSession } from './lane-session.js'

describe('lane session identity', () => {
  it.each([
    ['work', 'companion-go-work'],
    ['go', 'companion-go-go'],
  ] as const)('maps %s to the frozen exact id %s', (lane, expected) => {
    expect(laneSessionId(lane)).toBe(SessionId(expected))
  })
})

describe('live lane session resolution', () => {
  it('performs one direct SessionStore lookup for the requested lane', () => {
    const work = Session.create(SessionId('companion-go-work'))
    const get = vi.fn(() => work)
    const sessions = { get } as unknown as Pick<SessionStore, 'get'>

    expect(resolveLaneSession(sessions, 'work')).toBe(work)
    expect(get).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledWith(SessionId('companion-go-work'))
  })

  it('returns the current live object rather than caching or mirroring registry state', () => {
    const first = Session.create(SessionId('companion-go-go'))
    const replacement = Session.create(SessionId('companion-go-go'))
    const live = [first, replacement]
    const get = vi.fn(() => live.shift())
    const sessions = { get } as unknown as Pick<SessionStore, 'get'>

    expect(resolveLaneSession(sessions, 'go')).toBe(first)
    expect(resolveLaneSession(sessions, 'go')).toBe(replacement)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('reports absence when AgentLoop has not materialized the lane', () => {
    const get = vi.fn(() => undefined)
    const sessions = { get } as unknown as Pick<SessionStore, 'get'>

    expect(resolveLaneSession(sessions, 'work')).toBeUndefined()
  })
})
