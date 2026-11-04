import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { saveLatestCompanionState } from '../companion/persistence.js'
import type { CompanionState } from '../contracts/companion.js'
import type { GameState, GoRulesPort, PlayerColors } from '../contracts/rules.js'
import type { CanonicalGameRecord, GameAction } from '../rules/canonical-record.js'
import { serializeCanonicalGameRecord } from '../rules/canonical-record.js'
import { createTenukiGoRulesPort } from '../rules/tenuki-adapter.js'
import { restoreCompanionRuntime } from './recovery.js'

const USER_BLACK: PlayerColors = { user: 'black', deepseek: 'white' }
const GAME_ID = 'restart-game'

type Persona = { readonly placeholder: string }
type Mood = { readonly confidence: number }

function companionState(
  attentionMode: CompanionState<Persona, Mood>['attentionMode'],
): CompanionState<Persona, Mood> {
  return {
    persona: { placeholder: 'uncompiled' },
    mood: { confidence: 3 },
    attentionMode,
    variationSeed: 'seed-restored',
  }
}

function canonicalRecord(actions: readonly GameAction[]): CanonicalGameRecord {
  return {
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    actions,
  }
}

function playLive(port: GoRulesPort, actions: readonly GameAction[]): void {
  port.createGame({
    gameId: GAME_ID,
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: USER_BLACK,
  })
  actions.forEach((action, index) => {
    const result =
      action.type === 'play'
        ? port.play(GAME_ID, action.by, action.point)
        : action.type === 'pass'
          ? port.pass(GAME_ID, action.by)
          : port.resign(GAME_ID, action.by)
    if (!result.ok) {
      throw new Error(`live action ${index + 1} (${action.type}) was rejected: ${result.reason}`)
    }
  })
}

function restartedLanes(missing?: 'work' | 'go') {
  const work = Session.create(SessionId('companion-go-work'))
  const go = Session.create(SessionId('companion-go-go'))
  const live = new Map<string, Session>()
  if (missing !== 'work') live.set('companion-go-work', work)
  if (missing !== 'go') live.set('companion-go-go', go)
  const sessions = {
    get: (id: SessionId) => live.get(String(id)),
  } as unknown as Pick<SessionStore, 'get'>
  return { work, go, sessions }
}

const PLAYING_ACTIONS: readonly GameAction[] = [
  { type: 'play', by: 'user', point: { x: 1, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
  { type: 'play', by: 'user', point: { x: 0, y: 1 } },
  { type: 'play', by: 'deepseek', point: { x: 5, y: 5 } },
  { type: 'play', by: 'user', point: { x: 2, y: 2 } },
  { type: 'pass', by: 'deepseek' },
  { type: 'play', by: 'user', point: { x: 3, y: 3 } },
  { type: 'play', by: 'deepseek', point: { x: 4, y: 4 } },
  { type: 'pass', by: 'user' },
  { type: 'pass', by: 'deepseek' },
  { type: 'play', by: 'user', point: { x: 4, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 2, y: 6 } },
  { type: 'play', by: 'user', point: { x: 6, y: 2 } },
  { type: 'play', by: 'deepseek', point: { x: 3, y: 7 } },
]

const PRE_RESIGN_ACTIONS: readonly GameAction[] = [
  { type: 'play', by: 'user', point: { x: 1, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
  { type: 'play', by: 'user', point: { x: 0, y: 1 } },
  { type: 'play', by: 'deepseek', point: { x: 5, y: 5 } },
  { type: 'play', by: 'user', point: { x: 2, y: 2 } },
  { type: 'pass', by: 'deepseek' },
]

const RESIGN_ACTIONS: readonly GameAction[] = [
  ...PRE_RESIGN_ACTIONS,
  { type: 'resign', by: 'user' },
]

function liveSnapshot(actions: readonly GameAction[]): GameState {
  const port = createTenukiGoRulesPort()
  playLive(port, actions)
  return port.getState(GAME_ID)
}

const directories: string[] = []

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'companion-recovery-'))
  directories.push(directory)
  return directory
}

async function savedCompanionStatePath(
  state: CompanionState<Persona, Mood>,
): Promise<string> {
  const filePath = join(await tempDirectory(), 'companion-state.json')
  await saveLatestCompanionState(filePath, state)
  return filePath
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('crash / resume recovery (Spec §36)', () => {
  it('restores both lane sessions, CompanionState, attention mode and the board after a restart', async () => {
    const saved = companionState('strict')
    const companionStatePath = await savedCompanionStatePath(saved)
    const record = canonicalRecord(PLAYING_ACTIONS)
    const persisted = serializeCanonicalGameRecord(record)
    const crashedBoard = liveSnapshot(PLAYING_ACTIONS)

    const lanes = restartedLanes()
    const recovered = await restoreCompanionRuntime(
      {
        sessions: lanes.sessions,
        companionStatePath,
        game: { gameId: GAME_ID, colors: USER_BLACK, canonicalRecord: persisted },
      },
      createTenukiGoRulesPort(),
    )

    expect(recovered.sessions.work).toBe(lanes.work)
    expect(recovered.sessions.go).toBe(lanes.go)
    expect(recovered.companion?.state).toEqual(saved)
    expect(recovered.companion?.attentionMode).toBe('strict')

    expect(recovered.game?.record).toEqual(record)
    expect(recovered.game?.state).toEqual(crashedBoard)
    expect(recovered.game?.state.stones).toEqual(crashedBoard.stones)
    expect(recovered.game?.state.toPlay).toBe(crashedBoard.toPlay)
    expect(recovered.game?.state.moveNumber).toBe(PLAYING_ACTIONS.length)
    expect(recovered.game?.state.captures).toEqual(crashedBoard.captures)
    expect(recovered.game?.state.lastMove).toEqual(crashedBoard.lastMove)
    expect(recovered.game?.state.status).toBe('playing')
    expect(recovered.game?.state.outcome).toBeNull()
  })

  it('restores the board from the canonical record through the port, not from a snapshot', async () => {
    const companionStatePath = await savedCompanionStatePath(companionState('normal'))
    const persisted = serializeCanonicalGameRecord(canonicalRecord(PLAYING_ACTIONS))

    const first = await restoreCompanionRuntime(
      {
        sessions: restartedLanes().sessions,
        companionStatePath,
        game: { gameId: GAME_ID, colors: USER_BLACK, canonicalRecord: persisted },
      },
      createTenukiGoRulesPort(),
    )
    const second = await restoreCompanionRuntime(
      {
        sessions: restartedLanes().sessions,
        companionStatePath,
        game: { gameId: GAME_ID, colors: USER_BLACK, canonicalRecord: persisted },
      },
      createTenukiGoRulesPort(),
    )

    expect(first.game?.state).toEqual(liveSnapshot(PLAYING_ACTIONS))
    expect(first.game?.state).toEqual(second.game?.state)
    expect(first.game?.state.gameId).toBe(GAME_ID)
    expect(first.game?.state.colors).toEqual(USER_BLACK)
  })

  it('restarts into Work focus by default', async () => {
    const companionStatePath = await savedCompanionStatePath(companionState('mofish'))
    const recovered = await restoreCompanionRuntime(
      {
        sessions: restartedLanes().sessions,
        companionStatePath,
        game: {
          gameId: GAME_ID,
          colors: USER_BLACK,
          canonicalRecord: serializeCanonicalGameRecord(canonicalRecord(PLAYING_ACTIONS)),
        },
      },
      createTenukiGoRulesPort(),
    )

    expect(recovered.focus).toEqual({ activeLane: 'work', llmRunning: false })
    expect(Object.keys(recovered.focus).sort()).toEqual(['activeLane', 'llmRunning'])
  })

  it('keeps a resigned game terminal with the same winner and reason after restart', async () => {
    const companionStatePath = await savedCompanionStatePath(companionState('strict'))
    const persisted = serializeCanonicalGameRecord(canonicalRecord(RESIGN_ACTIONS))
    const beforeResignation = liveSnapshot(PRE_RESIGN_ACTIONS)

    const port = createTenukiGoRulesPort()
    const recovered = await restoreCompanionRuntime(
      {
        sessions: restartedLanes().sessions,
        companionStatePath,
        game: { gameId: GAME_ID, colors: USER_BLACK, canonicalRecord: persisted },
      },
      port,
    )

    expect(recovered.game?.state.status).toBe('over')
    expect(recovered.game?.state.outcome).toEqual({
      winner: 'deepseek',
      loser: 'user',
      reason: 'resignation',
    })
    expect(recovered.game?.resignation).toEqual({ resignedBy: 'user', winner: 'deepseek' })

    expect(recovered.game?.state.stones).toEqual(beforeResignation.stones)
    expect(recovered.game?.state.moveNumber).toBe(PRE_RESIGN_ACTIONS.length)
    expect(recovered.game?.state.captures).toEqual(beforeResignation.captures)
    expect(recovered.game?.state.lastMove).toEqual(beforeResignation.lastMove)

    for (const result of [
      port.play(GAME_ID, 'user', { x: 8, y: 8 }),
      port.pass(GAME_ID, 'user'),
      port.resign(GAME_ID, 'user'),
    ]) {
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toBe('game-over')
    }
    expect(port.getState(GAME_ID)).toEqual(recovered.game?.state)
  })

  it('recovers a session-only restart when no game was persisted', async () => {
    const companionStatePath = await savedCompanionStatePath(companionState('manual'))

    const recovered = await restoreCompanionRuntime(
      { sessions: restartedLanes().sessions, companionStatePath },
      createTenukiGoRulesPort(),
    )

    expect(recovered.game).toBeNull()
    expect(recovered.companion?.attentionMode).toBe('manual')
    expect(recovered.focus.activeLane).toBe('work')
  })

  it('reports a missing CompanionState snapshot instead of inventing one', async () => {
    const directory = await tempDirectory()
    const companionStatePath = join(directory, 'companion-state.json')

    const recovered = await restoreCompanionRuntime(
      {
        sessions: restartedLanes().sessions,
        companionStatePath,
        game: {
          gameId: GAME_ID,
          colors: USER_BLACK,
          canonicalRecord: serializeCanonicalGameRecord(canonicalRecord(PLAYING_ACTIONS)),
        },
      },
      createTenukiGoRulesPort(),
    )

    expect(recovered.companion).toBeNull()
    expect(recovered.game).not.toBeNull()
  })

  it('rejects an unsupported CompanionState store version deterministically', async () => {
    const directory = await tempDirectory()
    const companionStatePath = join(directory, 'companion-state.json')
    await writeFile(
      companionStatePath,
      JSON.stringify({ version: 2, state: companionState('normal') }),
      'utf8',
    )

    await expect(
      restoreCompanionRuntime(
        { sessions: restartedLanes().sessions, companionStatePath },
        createTenukiGoRulesPort(),
      ),
    ).rejects.toThrow('unsupported CompanionState store version: 2')
  })

  it('rejects a persisted attention mode outside the frozen four', async () => {
    const directory = await tempDirectory()
    const companionStatePath = join(directory, 'companion-state.json')
    await writeFile(
      companionStatePath,
      JSON.stringify({
        version: 1,
        state: { ...companionState('normal'), attentionMode: 'hyper' },
      }),
      'utf8',
    )

    await expect(
      restoreCompanionRuntime(
        { sessions: restartedLanes().sessions, companionStatePath },
        createTenukiGoRulesPort(),
      ),
    ).rejects.toThrow('has an unknown attentionMode "hyper"')
  })

  it('rejects a corrupt canonical record instead of restoring a fabricated board', async () => {
    const companionStatePath = await savedCompanionStatePath(companionState('normal'))

    await expect(
      restoreCompanionRuntime(
        {
          sessions: restartedLanes().sessions,
          companionStatePath,
          game: { gameId: GAME_ID, colors: USER_BLACK, canonicalRecord: '{"boardSize":9' },
        },
        createTenukiGoRulesPort(),
      ),
    ).rejects.toThrow('canonical game record is not valid JSON')
  })

  it.each(['work', 'go'] as const)(
    'rejects a restart where the %s lane session was not restored',
    async (lane) => {
      const companionStatePath = await savedCompanionStatePath(companionState('normal'))

      await expect(
        restoreCompanionRuntime(
          { sessions: restartedLanes(lane).sessions, companionStatePath },
          createTenukiGoRulesPort(),
        ),
      ).rejects.toThrow(`lane session companion-go-${lane} (${lane}) was not restored`)
    },
  )

  it('writes no transaction, journal or pending-command artifact during recovery', async () => {
    const state = companionState('strict')
    const directory = await tempDirectory()
    const companionStatePath = join(directory, 'companion-state.json')
    await saveLatestCompanionState(companionStatePath, state)

    await restoreCompanionRuntime(
      {
        sessions: restartedLanes().sessions,
        companionStatePath,
        game: {
          gameId: GAME_ID,
          colors: USER_BLACK,
          canonicalRecord: serializeCanonicalGameRecord(canonicalRecord(PLAYING_ACTIONS)),
        },
      },
      createTenukiGoRulesPort(),
    )

    expect(await readdir(directory)).toEqual(['companion-state.json'])
  })
})
