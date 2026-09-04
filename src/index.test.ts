import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as CompanionGo from './index.js'

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
    const create = vi.fn(async (options: { sessionId: string }) => ({
      agent: { session: { id: options.sessionId } },
      dispose: async () => undefined,
    }))
    const on = vi.fn((_event: string, _listener: unknown) => vi.fn())
    const ctx = { agents: { create }, on } as unknown as Context

    await CompanionGo.apply(ctx)

    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls.map(([options]) => options)).toEqual([
      { sessionId: 'companion-go-work' },
      { sessionId: 'companion-go-go' },
    ])
    expect(on.mock.calls.map(([event]) => event)).toEqual([
      'session/event',
      'llm/stream',
      'agent/pre-step',
      'agent/status',
      'focus/lane-switched',
    ])
  })

  it('propagates factory collisions instead of adopting an existing identity', async () => {
    const collision = new Error('session id already exists: companion-go-work')
    const create = vi.fn(async (_options: unknown) => { throw collision })
    const ctx = { agents: { create } } as unknown as Context

    await expect(CompanionGo.apply(ctx)).rejects.toBe(collision)
    expect(create).toHaveBeenCalledOnce()
  })
})
