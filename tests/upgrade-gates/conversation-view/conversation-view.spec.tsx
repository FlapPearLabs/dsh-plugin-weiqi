// @vitest-environment jsdom
/**
 * WAVE-E-S01 retained spike: prove the pinned DSH Web conversation.view seam
 * with the production slot renderer, the shipped Conversation shell, and the
 * shipped Trajectory view mounted in one jsdom DOM tree.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {
  ConversationSnapshot, ISession, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  SlotTestRuntime, stubSettingsScope, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply as conversationApply,
  inject as conversationInject,
  type ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  apply as trajectoryApply,
  inject as trajectoryInject,
} from '@deepseek-ai/dsh-client-ui-trajectory/client'

usePinnedBrowserLanguages('zh-CN')

const WORK = 'work-session' as SessionId
const GO = 'go-session' as SessionId
const WORK_TRANSCRIPT = 'WORK_TRANSCRIPT_ONLY'
const GO_TRANSCRIPT = 'GO_TRANSCRIPT_ONLY'
const GO_STATUS = 'Opponent moved · Q10'
const WORK_SNAPSHOT = 'hash normalization changed; validating again'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'weiqi/game-notice': { text: string }
    'weiqi/work-snapshot': { summary: string }
  }
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps): ReactNode {
  return renderSlot('conversation', {})
}

const SHELL_CHILDREN = {
  conversation: { kind: 'single', scope: 'session-maybe' },
  details: { kind: 'single', scope: 'session' },
} as const

function userNode(text: string, seq: number): ConversationSnapshot['nodes'][number] {
  return {
    kind: 'user',
    seq,
    time: seq * 1_000,
    content: [{ type: 'text', text }],
    source: null,
  }
}

function transcriptMarker(nodes: ConversationSnapshot['nodes']): string {
  for (const node of nodes) {
    if (node.kind !== 'user') continue
    for (const block of node.content) {
      if (block.type === 'text') return block.text
    }
  }
  return 'NO_TRANSCRIPT'
}

function GoViewProbe({ sessionId, useSession, useProjection }: ConvViewProps) {
  const transcript = useSession(snapshot => transcriptMarker(snapshot.nodes))
  const work = useProjection('weiqi/work-snapshot')
  return (
    <section data-testid="go-view" data-session-id={sessionId}>
      <h2>Go View Probe</h2>
      <output data-testid="go-session-transcript">{transcript}</output>
      <aside data-testid="go-work-snapshot">{work?.summary ?? 'NO_WORK_SNAPSHOT'}</aside>
    </section>
  )
}

type HeaderActionProps = PropsRuntime<'conversation.session.header.actions'>
function WorkGoStatus({ useProjection }: HeaderActionProps) {
  const notice = useProjection('weiqi/game-notice')
  if (notice === undefined) return null
  return <span data-testid="work-go-status">{notice.text}</span>
}

function applyGoProbe(ctx: Context): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'go',
    order: 20,
    label: 'Go',
  }, GoViewProbe))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'weiqi-go-status',
    order: 90,
  }, WorkGoStatus))
}

async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)

  const loadOlder = vi.fn<ISession['loadOlder']>(() => Promise.resolve())
  await runtime.sessions.add({
    id: WORK,
    summary: { title: 'Work', displayTitle: 'Work', cwd: '/work' },
    snapshot: { nodes: [userNode(WORK_TRANSCRIPT, 1)] },
    session: { loadOlder },
  }, { current: false })
  await runtime.sessions.add({
    id: GO,
    summary: { title: 'Go', displayTitle: 'Go', cwd: '/go' },
    snapshot: { nodes: [userNode(GO_TRANSCRIPT, 1)] },
    session: { loadOlder },
  }, { current: false })
  runtime.sessions.behavior(WORK).projections.set('weiqi/game-notice', { text: GO_STATUS })
  runtime.sessions.behavior(GO).projections.set('weiqi/work-snapshot', { summary: WORK_SNAPSHOT })

  await runtime.root.declare(SHELL_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...conversationInject], apply: conversationApply })
  await runtime.mount({ inject: [...trajectoryInject], apply: trajectoryApply })
  const probe = await runtime.mount({ inject: ['slots'], apply: applyGoProbe })
  await runtime.sessions.setCurrent(WORK)
  const view = runtime.renderRoot()
  return { runtime, view, probe }
}

describe('pinned DSH conversation.view extension seam', () => {
  it('mounts Go beside Chat and Trajectory while keeping Work/Go snapshots isolated', async () => {
    const { runtime, view, probe } = await bench()

    expect(within(view.getByRole('tablist')).getAllByRole('tab').map(tab => tab.textContent))
      .toEqual(['对话', '轨迹', 'Go'])
    expect(view.getByRole('tab', { name: '对话' }).getAttribute('aria-selected')).toBe('true')
    expect(view.container.querySelector('[data-chat-flow]')).not.toBeNull()
    expect(view.queryByText(GO_TRANSCRIPT)).toBeNull()
    expect(view.getByTestId('work-go-status').textContent).toBe(GO_STATUS)

    fireEvent.click(view.getByRole('tab', { name: 'Go' }))
    expect(view.getByTestId('go-view').getAttribute('data-session-id')).toBe(WORK)
    expect(view.getByTestId('go-session-transcript').textContent).toBe(WORK_TRANSCRIPT)
    expect(view.getByTestId('go-work-snapshot').textContent).toBe('NO_WORK_SNAPSHOT')
    expect(view.queryByText(GO_TRANSCRIPT)).toBeNull()

    await runtime.sessions.setCurrent(GO)
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Go' }).hasAttribute('disabled')).toBe(true)
    })
    expect(view.getByRole('tab', { name: '对话' }).getAttribute('aria-selected')).toBe('true')
    expect(view.container.querySelector('[data-chat-flow]')).not.toBeNull()
    expect(view.queryByText(WORK_TRANSCRIPT)).toBeNull()
    expect(view.queryByTestId('work-go-status')).toBeNull()

    fireEvent.click(view.getByRole('tab', { name: 'Go' }))
    expect(view.getByTestId('go-view').getAttribute('data-session-id')).toBe(GO)
    expect(view.getByTestId('go-session-transcript').textContent).toBe(GO_TRANSCRIPT)
    expect(view.getByTestId('go-work-snapshot').textContent).toBe(WORK_SNAPSHOT)
    expect(view.queryByText(WORK_TRANSCRIPT)).toBeNull()

    await runtime.sessions.setCurrent(WORK)
    await waitFor(() => {
      expect(view.getByTestId('go-session-transcript').textContent).toBe(WORK_TRANSCRIPT)
    })
    expect(view.queryByText(GO_TRANSCRIPT)).toBeNull()
    expect(view.getByTestId('go-work-snapshot').textContent).toBe('NO_WORK_SNAPSHOT')
    expect(view.getByTestId('work-go-status').textContent).toBe(GO_STATUS)

    console.log('E-S01 DOM TRACE', JSON.stringify({
      tabs: within(view.getByRole('tablist')).getAllByRole('tab').map(tab => tab.textContent),
      work: { sessionId: WORK, transcript: WORK_TRANSCRIPT, goStatus: GO_STATUS },
      go: { sessionId: GO, transcript: GO_TRANSCRIPT, workSnapshot: WORK_SNAPSHOT },
    }))

    await probe.dispose()
    await waitFor(() => { expect(view.queryByRole('tab', { name: 'Go' })).toBeNull() })
    expect(within(view.getByRole('tablist')).getAllByRole('tab').map(tab => tab.textContent))
      .toEqual(['对话', '轨迹'])
    expect(view.queryByTestId('work-go-status')).toBeNull()
    expect(view.container.querySelector('[data-chat-flow]')).not.toBeNull()

    await runtime.dispose()
  })
})
