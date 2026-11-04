import type { Context } from '@deepseek-ai/cordis'
import type { CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import * as CompanionGo from './index.js'
import { GO_PRESET_ID } from './preset/go-preset.js'

/**
 * Stand-in for the pinned AgentLoop factory: it performs the same durable
 * header construction `SessionStore.create` performs (it folds `CreateAgentOptions.meta`
 * into the real `SessionHeader` through the real `Session.create` boundary).
 */
function laneFactory(sessions: Session[]) {
  return vi.fn(async (options: CreateAgentOptions) => {
    const id = SessionId(options.sessionId)
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 0,
      ...options.meta,
    })
    sessions.push(session)
    return { agent: { session }, dispose: async () => undefined }
  })
}

describe('Companion Go Cordis entry', () => {
  it('uses the named function-plugin namespace required by Loader', () => {
    expect(CompanionGo.name).toBe('companion-go')
    expect(CompanionGo.inject).toEqual(['agents', 'llm'])
    expect(typeof CompanionGo.apply).toBe('function')
    expect('default' in CompanionGo).toBe(false)
  })

  it('does not expose Runtime ownership internals from the package root', () => {
    expect('SessionRegistry' in CompanionGo).toBe(false)
    expect('LANES' in CompanionGo).toBe(false)
    expect('laneSessionId' in CompanionGo).toBe(false)
    expect('resolveLaneSession' in CompanionGo).toBe(false)
  })

  it('asks the AgentRegistry factory to materialize both exact lane identities', async () => {
    const sessions: Session[] = []
    const create = laneFactory(sessions)
    const on = vi.fn((_event: string, _listener: unknown) => vi.fn())
    const ctx = { agents: { create }, on } as unknown as Context

    await CompanionGo.apply(ctx)

    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls.map(([options]) => options)).toEqual([
      { sessionId: 'companion-go-work' },
      { sessionId: 'companion-go-go', meta: { agentPreset: GO_PRESET_ID } },
    ])
    expect(on.mock.calls.map(([event]) => event)).toEqual([
      'session/event',
      'llm/stream',
      'agent/pre-step',
      'agent/status',
      'focus/lane-switched',
    ])
  })

  it('stamps only the Go lane session header with the Go preset id', async () => {
    const sessions: Session[] = []
    const create = laneFactory(sessions)
    const on = vi.fn((_event: string, _listener: unknown) => vi.fn())
    const ctx = { agents: { create }, on } as unknown as Context

    await CompanionGo.apply(ctx)

    expect(sessions).toHaveLength(2)
    expect(sessions.map(session => session.header.agentPreset)).toEqual([undefined, GO_PRESET_ID])
    expect(sessions[1]?.header.agentPreset).toBe(GO_PRESET_ID)
  })

  it('propagates factory collisions instead of adopting an existing identity', async () => {
    const collision = new Error('session id already exists: companion-go-work')
    const create = vi.fn(async (_options: unknown) => { throw collision })
    const ctx = { agents: { create } } as unknown as Context

    await expect(CompanionGo.apply(ctx)).rejects.toBe(collision)
    expect(create).toHaveBeenCalledOnce()
  })
})
