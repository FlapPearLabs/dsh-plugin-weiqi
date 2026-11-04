import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { GO_TOOL_DEFINITIONS, GO_TOOL_NAMES } from '../../src/tools/go/go-tools.js'
import {
  BENCHMARK_TOOL_NAME_TABLE,
  BenchmarkToolNameCollisionError,
  BenchmarkToolNameError,
  PROVIDER_TOOL_NAME_PATTERN,
  createBenchmarkToolNameTable,
  fromProviderToolName,
  toProviderMessages,
  toProviderToolName,
  toProviderToolSchemas,
} from './tool-name-mapping.js'

describe('provider-safe tool name mapping (WAVE-C-T10)', () => {
  it('maps every real Go tool to a unique provider-safe name and back', () => {
    expect(BENCHMARK_TOOL_NAME_TABLE.map(entry => entry.original)).toEqual([...GO_TOOL_NAMES])
    expect(BENCHMARK_TOOL_NAME_TABLE).toHaveLength(GO_TOOL_NAMES.length)

    const providerNames = BENCHMARK_TOOL_NAME_TABLE.map(entry => entry.provider)
    expect(new Set(providerNames).size).toBe(providerNames.length)
    for (const providerName of providerNames) {
      expect(providerName).toMatch(PROVIDER_TOOL_NAME_PATTERN)
    }

    for (const name of GO_TOOL_NAMES) {
      expect(toProviderToolName(name)).toBe(name.replace(/\./g, '_'))
      expect(fromProviderToolName(toProviderToolName(name))).toBe(name)
    }

    expect(toProviderToolName('go.play')).toBe('go_play')
    expect(fromProviderToolName('go_play')).toBe('go.play')
    expect(toProviderToolName('go.request_deep_think')).toBe('go_request_deep_think')
    expect(fromProviderToolName('go_request_deep_think')).toBe('go.request_deep_think')
  })

  it('refuses an unknown outbound name instead of guessing a provider name', () => {
    let caught: unknown
    try {
      toProviderToolName('go.teleport')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BenchmarkToolNameError)
    expect((caught as BenchmarkToolNameError).direction).toBe('outbound')
    expect((caught as BenchmarkToolNameError).toolName).toBe('go.teleport')
  })

  it('refuses an unknown inbound name instead of passing it through to the registry', () => {
    let caught: unknown
    try {
      fromProviderToolName('go_teleport')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BenchmarkToolNameError)
    expect((caught as BenchmarkToolNameError).direction).toBe('inbound')
    expect((caught as BenchmarkToolNameError).toolName).toBe('go_teleport')
  })

  it('fails the table build on a collision instead of shadowing one tool', () => {
    expect(() => createBenchmarkToolNameTable(['go.a_b', 'go.a.b'])).toThrow(
      BenchmarkToolNameCollisionError,
    )
  })

  it('fails the table build when an encoded name would not be provider-safe', () => {
    expect(() => createBenchmarkToolNameTable(['go.play!'])).toThrow(BenchmarkToolNameError)
    expect(() => createBenchmarkToolNameTable(['go.play!'])).toThrow(/does not match/)
  })

  it('maps request tool schemas without changing their descriptions or parameters', () => {
    const schemas = GO_TOOL_DEFINITIONS.map(definition => ({
      name: definition.name,
      description: definition.description,
      parameters: { ...definition.parameters },
    }))
    const mapped = toProviderToolSchemas(schemas)

    expect(mapped.map(tool => tool.name)).toEqual(
      GO_TOOL_NAMES.map(name => name.replace(/\./g, '_')),
    )
    for (const [index, tool] of mapped.entries()) {
      expect(tool.description).toBe(schemas[index]?.description)
      expect(tool.parameters).toEqual(schemas[index]?.parameters)
    }
  })

  it('maps assistant history tool-call names but leaves tool results untouched', () => {
    const assistant = createAssistantMessage({
      content: [{
        type: 'tool-call',
        id: CallId('prior-call'),
        name: 'go.play',
        arguments: '{"point":{"x":1,"y":1}}',
      }],
      source: { provider: 'benchmark-scripted', model: 'scripted-legal-move-adapter-v1' },
    })
    const [mapped] = toProviderMessages([assistant])

    expect(mapped?.content[0]).toMatchObject({ type: 'tool-call', name: 'go_play' })

    const withUnknown = createAssistantMessage({
      content: [{
        type: 'tool-call',
        id: CallId('unknown-call'),
        name: 'go.teleport',
        arguments: '{}',
      }],
      source: { provider: 'benchmark-scripted', model: 'scripted-legal-move-adapter-v1' },
    })
    expect(() => toProviderMessages([withUnknown])).toThrow(BenchmarkToolNameError)
  })
})
