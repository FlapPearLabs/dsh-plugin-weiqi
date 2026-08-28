import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'

const HARD_CAP = 257
const OVERSIZED_CAP = 8_192
const servers: Server[] = []

interface CapturedRequest {
  model?: string
  max_tokens?: number
}

async function wireServer(expectedRequests: number): Promise<{
  url: string
  requests: CapturedRequest[]
  complete: Promise<void>
}> {
  const requests: CapturedRequest[] = []
  const complete = Promise.withResolvers<void>()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as CapturedRequest)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of [
        '{"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
        '{"choices":[{"delta":{"content":"bounded"}}]}',
        '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
        '[DONE]',
      ]) response.write(`data: ${event}\n\n`)
      response.end()
      if (requests.length === expectedRequests) complete.resolve()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('wire server did not bind a TCP port')
  return { url: `http://127.0.0.1:${address.port}`, requests, complete: complete.promise }
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

describe('WAVE-C-S01 pinned request hard-cap seam', () => {
  it('carries a plugin-controlled cap through AgentLoop to the DeepSeek wire request', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-key')
    const wire = await wireServer(2)
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, {
      baseURL: wire.url,
      maxTokens: OVERSIZED_CAP,
      reasoningEffort: 'off',
    })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })

    const go = ctx.agentLoop.create(SessionId('companion-go'), {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: OVERSIZED_CAP,
    })
    const requestTrace: Array<{
      turn: number
      step: number
      proposedMaxTokens: number | undefined
      hardCappedMaxTokens: number
    }> = []
    go.ctx.on('agent/request', async ({ turn, step }, next): Promise<LlmCallConfig> => {
      const proposed = await next()
      const hardCappedMaxTokens = Math.min(proposed.maxTokens ?? HARD_CAP, HARD_CAP)
      requestTrace.push({ turn, step, proposedMaxTokens: proposed.maxTokens, hardCappedMaxTokens })
      return { ...proposed, maxTokens: hardCappedMaxTokens }
    })
    const work = ctx.agentLoop.create(SessionId('work'), {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: OVERSIZED_CAP,
    })

    send(go, 'play one bounded turn')
    await go.whenIdle()
    send(work, 'run one unaffected work turn')
    await work.whenIdle()
    await wire.complete

    const header = go.session.events.find(event => event.type === 'request/header')
    const recordedCap = header?.type === 'request/header'
      ? header.data.header.config.maxTokens
      : undefined
    const goWire = wire.requests[0]
    const workHeader = work.session.events.find(event => event.type === 'request/header')
    const workRecordedCap = workHeader?.type === 'request/header'
      ? workHeader.data.header.config.maxTokens
      : undefined
    const workWire = wire.requests[1]
    console.info('C-S01 TRACE', JSON.stringify({
      requestTrace,
      go: { recordedCap, outgoingMaxTokens: goWire?.max_tokens },
      work: { recordedCap: workRecordedCap, outgoingMaxTokens: workWire?.max_tokens },
    }))

    expect(requestTrace).toEqual([{
      turn: 1,
      step: 1,
      proposedMaxTokens: OVERSIZED_CAP,
      hardCappedMaxTokens: HARD_CAP,
    }])
    expect(recordedCap).toBe(HARD_CAP)
    expect(goWire?.max_tokens).toBe(HARD_CAP)
    expect(workRecordedCap).toBe(OVERSIZED_CAP)
    expect(workWire?.max_tokens).toBe(OVERSIZED_CAP)
  })
})
