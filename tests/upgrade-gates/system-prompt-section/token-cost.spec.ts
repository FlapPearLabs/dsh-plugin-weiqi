import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'

/**
 * Q7 measurement instrument (NOT a gate): the provider-reported input cost of
 * one system-section change in one session.
 *
 * It needs a real DeepSeek endpoint, so it is opt-in and skips otherwise:
 *   DEEPSEEK_API_KEY=... DSH_SPIKE_MODEL=<catalog id> DSH_SPIKE_PAID_MEASURE=1
 *
 * Three natural requests on one session:
 *   1. snapshot A0
 *   2. snapshot unchanged  -> the prompt prefix is reused; cacheReadTokens is
 *      the reused prefix
 *   3. snapshot B1         -> the system slot changes, so the prefix restarts;
 *      cacheReadTokens for the changed request is the measured loss
 *
 * The numbers come from the loop's own `assistant/message.usage`, whose
 * `inputTokens` excludes cache reads and `cacheReadTokens` reports them
 * (disjoint counts; billed input = inputTokens + cacheReadTokens +
 * cacheWriteTokens).
 */

const enabled = process.env.DEEPSEEK_API_KEY !== undefined
  && process.env.DSH_SPIKE_MODEL !== undefined
  && process.env.DSH_SPIKE_PAID_MEASURE === '1'

type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }

function message(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function usages(agent: Agent): Usage[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'assistant/message' }> => event.type === 'assistant/message')
    .map(event => event.data.usage)
    .filter((usage): usage is Usage => usage !== undefined)
}

function billed(usage: Usage | undefined): number {
  if (usage === undefined) return 0
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

describe.skipIf(!enabled)('Q7 provider token cost of one section change', () => {
  it('records usage for unchanged and changed system sections', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { reasoningEffort: 'off', thinking: 'disabled' })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })

    const agent = ctx.agentLoop.create(SessionId('section-token-cost'), {
      provider: 'deepseek-official',
      model: process.env.DSH_SPIKE_MODEL,
    })

    let value: string | undefined = 'A0'
    agent.ctx.systemPrompt.variable('go_snapshot', () => value)
    agent.ctx.systemPrompt.section({
      name: 'companion-go:go-snapshot',
      order: 10,
      text: () => value === undefined ? '' : 'GO_SNAPSHOT={{go_snapshot}}',
    })

    agent.followup(message('one'))
    await agent.whenIdle()
    agent.followup(message('two'))
    await agent.whenIdle()
    value = 'B1'
    agent.followup(message('three'))
    await agent.whenIdle()

    const recorded = usages(agent)
    expect(recorded).toHaveLength(3)

    const [first, unchanged, changed] = recorded
    console.log('DSH_SECTION_TOKEN_COST ' + JSON.stringify({
      requests: recorded.length,
      first,
      unchanged,
      changed,
      unchangedBilled: billed(unchanged),
      changedBilled: billed(changed),
      billedDeltaOfChange: billed(changed) - billed(unchanged),
      cacheReadLostByChange: (unchanged.cacheReadTokens ?? 0) - (changed.cacheReadTokens ?? 0),
      firstBilled: billed(first),
    }))
  })
})
