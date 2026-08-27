import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as CompanionGo from './index.js'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('Companion Go DSH plugin entry', () => {
  it('mounts and disposes as a Cordis plugin without registering Phase A behavior', async () => {
    const ctx = new Context()
    contexts.push(ctx)

    const fiber = await ctx.plugin(CompanionGo)

    expect(CompanionGo.name).toBe('companion-go')
    expect(fiber.name).toBe('companion-go')
    await expect(fiber.dispose()).resolves.toBeUndefined()
  })
})
