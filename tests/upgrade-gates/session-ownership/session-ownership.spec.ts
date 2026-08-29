import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as CompanionGo from './plugin/index.ts'
import { resolveLaneSession } from './plugin/runtime/lane-session.ts'

const liveContexts: Context[] = []

afterEach(async () => {
  await Promise.all(liveContexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  liveContexts.push(ctx)
  return ctx
}

function appendUserMessage(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'companion-go-ownership-gate' },
  }), { surfaceOp: 'append' })
}

function userTexts(session: Session): string[] {
  return session.events
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> => event.type === 'user/message')
    .map(event => event.data.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(''))
}

describe('Companion Go real AgentLoop ownership gate', () => {
  it('materializes exact Agent/Session pairs, resolves them live, and keeps histories isolated', async () => {
    const ctx = await harness()
    await ctx.plugin(CompanionGo)

    const workId = SessionId('companion-go-work')
    const goId = SessionId('companion-go-go')
    const workAgent = ctx.agents.get(workId)
    const goAgent = ctx.agents.get(goId)
    const workSession = ctx.sessions.get(workId)
    const goSession = ctx.sessions.get(goId)

    expect(workAgent).toBeDefined()
    expect(goAgent).toBeDefined()
    expect(workSession).toBeDefined()
    expect(goSession).toBeDefined()
    expect(workAgent?.session).toBe(workSession)
    expect(goAgent?.session).toBe(goSession)
    expect(workAgent).not.toBe(goAgent)
    expect(workSession).not.toBe(goSession)
    expect(ctx.agents.list().map(agent => agent.id).sort()).toEqual([goId, workId].sort())
    expect(ctx.sessions.list().map(session => session.id).sort()).toEqual([goId, workId].sort())
    expect(resolveLaneSession(ctx.sessions, 'work')).toBe(workSession)
    expect(resolveLaneSession(ctx.sessions, 'go')).toBe(goSession)

    appendUserMessage(workSession!, 'work-only')
    appendUserMessage(goSession!, 'go-only')
    expect(userTexts(workSession!)).toEqual(['work-only'])
    expect(userTexts(goSession!)).toEqual(['go-only'])
  })

  it('rejects an exact-id collision and rolls back materialization completed earlier in apply', async () => {
    const ctx = await harness()
    const collision = ctx.sessions.create(SessionId('companion-go-go'))

    await expect(ctx.plugin(CompanionGo)).rejects.toThrow(/companion-go-go/)

    expect(ctx.agents.get(SessionId('companion-go-work'))).toBeUndefined()
    expect(ctx.sessions.get(SessionId('companion-go-work'))).toBeUndefined()
    expect(ctx.agents.get(SessionId('companion-go-go'))).toBeUndefined()
    expect(ctx.sessions.get(SessionId('companion-go-go'))).toBe(collision)
  })

  it('disposes both AgentLoop-owned pairs with the plugin fiber and remounts fresh pairs at the same ids', async () => {
    const ctx = await harness()
    const firstFiber = await ctx.plugin(CompanionGo)
    const workId = SessionId('companion-go-work')
    const goId = SessionId('companion-go-go')
    const firstWorkAgent = ctx.agents.get(workId)
    const firstGoAgent = ctx.agents.get(goId)
    const firstWorkSession = ctx.sessions.get(workId)
    const firstGoSession = ctx.sessions.get(goId)

    await firstFiber.dispose()

    expect(ctx.agents.get(workId)).toBeUndefined()
    expect(ctx.agents.get(goId)).toBeUndefined()
    expect(ctx.sessions.get(workId)).toBeUndefined()
    expect(ctx.sessions.get(goId)).toBeUndefined()

    await ctx.plugin(CompanionGo)

    expect(ctx.agents.get(workId)).toBeDefined()
    expect(ctx.agents.get(goId)).toBeDefined()
    expect(ctx.sessions.get(workId)).toBeDefined()
    expect(ctx.sessions.get(goId)).toBeDefined()
    expect(ctx.agents.get(workId)).not.toBe(firstWorkAgent)
    expect(ctx.agents.get(goId)).not.toBe(firstGoAgent)
    expect(ctx.sessions.get(workId)).not.toBe(firstWorkSession)
    expect(ctx.sessions.get(goId)).not.toBe(firstGoSession)
  })
})
