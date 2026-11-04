/**
 * The eight Spec §20 Phase A model-facing Go tools.
 *
 * Every tool is a thin boundary over `GoRulesPort`: reads go to `getState` /
 * `inspectGroup`, mutations go to `play` / `pass` / `resign`, and no tool ever
 * keeps board truth of its own. Budget accounting happens at the actual
 * execution (§22.3): `go.inspect_*` and `go.try_move` charge before touching
 * the port, `go.request_deep_think` records one bounded request, and an
 * accepted play/pass/resign commits the turn through C-T07's enforcement.
 *
 * Two deliberate limits:
 * - `go.try_move` reports local board observations only; ko / positional
 *   superko stay authoritative in `go.play`.
 * - `go.request_deep_think` records a request marker; the bounded §23 boost is
 *   WAVE-C-T08's policy and is never claimed here.
 */
import type { GoTurnEnforcement } from '../../budget/enforcement.js'
import type { GameNotice } from '../../contracts/bridge.js'
import type { GameState, GoRulesPort, Player } from '../../contracts/rules.js'
import type { GoToolPath } from '../../preset/go-preset.js'
import { readArguments, readGameId, readPoint, readRadius } from './arguments.js'
import { inspectRegion, observeLocalMove } from './board.js'
import { buildGameNotice } from './notice.js'
import type {
  GameNoticeSink,
  GoDeepThinkResult,
  GoInspectGroupResult,
  GoInspectRegionResult,
  GoPassResult,
  GoPlayResult,
  GoResignResult,
  GoStateResult,
  GoToolDefinition,
  GoToolParameters,
  GoToolRuntime,
  GoTryMoveResult,
} from './types.js'

/** The Go lane always acts as DeepSeek; the user acts through the board UI. */
export const GO_LANE_PLAYER: Player = 'deepseek'

const DEFAULT_REGION_RADIUS = 2

const GAME_ID_PROPERTY = Object.freeze({
  type: 'string',
  description: 'Authoritative game id.',
})

const POINT_PROPERTY = Object.freeze({
  type: 'object',
  description: 'Zero-based intersection; (0, 0) is the top-left corner.',
  properties: Object.freeze({
    x: Object.freeze({ type: 'integer' }),
    y: Object.freeze({ type: 'integer' }),
  }),
  required: Object.freeze(['x', 'y']),
  additionalProperties: false,
})

const RADIUS_PROPERTY = Object.freeze({
  type: 'integer',
  minimum: 0,
  description: `Square half-width around the point; defaults to ${DEFAULT_REGION_RADIUS}.`,
})

function parameters(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): GoToolParameters {
  return Object.freeze({
    type: 'object',
    properties: Object.freeze({ ...properties }),
    required: Object.freeze([...required]),
    additionalProperties: false,
  })
}

function runState(args: unknown, runtime: GoToolRuntime): GoStateResult {
  const toolPath = 'go.state'
  const record = readArguments(toolPath, args, ['gameId'])
  const gameId = readGameId(toolPath, record)
  return { ok: true, state: runtime.port.getState(gameId) }
}

function runInspectGroup(args: unknown, runtime: GoToolRuntime): GoInspectGroupResult {
  const toolPath = 'go.inspect_group'
  const record = readArguments(toolPath, args, ['gameId', 'point'])
  const gameId = readGameId(toolPath, record)
  const point = readPoint(toolPath, record.point, 'arguments.point')
  runtime.enforcement.beginInspect()
  return { ok: true, group: runtime.port.inspectGroup(gameId, point) }
}

function runInspectRegion(args: unknown, runtime: GoToolRuntime): GoInspectRegionResult {
  const toolPath = 'go.inspect_region'
  const record = readArguments(toolPath, args, ['gameId', 'point', 'radius'])
  const gameId = readGameId(toolPath, record)
  const point = readPoint(toolPath, record.point, 'arguments.point')
  const radius = readRadius(toolPath, record.radius) ?? DEFAULT_REGION_RADIUS
  runtime.enforcement.beginInspect()
  const state: GameState = runtime.port.getState(gameId)
  return { ok: true, region: inspectRegion(state, point, radius) }
}

function runTryMove(args: unknown, runtime: GoToolRuntime): GoTryMoveResult {
  const toolPath = 'go.try_move'
  const record = readArguments(toolPath, args, ['gameId', 'point'])
  const gameId = readGameId(toolPath, record)
  const point = readPoint(toolPath, record.point, 'arguments.point')
  runtime.enforcement.beginTryMove()

  const observation = observeLocalMove(runtime.port.getState(gameId), GO_LANE_PLAYER, point)
  const result: GoTryMoveResult = {
    ok: true,
    point,
    basis: 'local-board',
    legal: observation.legal,
    captures: observation.captures,
    localLiberties: observation.localLiberties,
  }
  return observation.reason === undefined ? result : { ...result, reason: observation.reason }
}

function runPlay(args: unknown, runtime: GoToolRuntime): GoPlayResult {
  const toolPath = 'go.play'
  const record = readArguments(toolPath, args, ['gameId', 'point'])
  const gameId = readGameId(toolPath, record)
  const point = readPoint(toolPath, record.point, 'arguments.point')

  const result = runtime.port.play(gameId, GO_LANE_PLAYER, point)
  if (!result.ok) {
    return { ok: false, reason: result.reason, state: result.state }
  }

  runtime.enforcement.recordCommittedAction('play')
  return {
    ok: true,
    state: result.state,
    captured: result.captured,
    notice: runtime.publishGameNotice(result.state),
  }
}

function runPass(args: unknown, runtime: GoToolRuntime): GoPassResult {
  const toolPath = 'go.pass'
  const record = readArguments(toolPath, args, ['gameId'])
  const gameId = readGameId(toolPath, record)

  const result = runtime.port.pass(gameId, GO_LANE_PLAYER)
  if (!result.ok) {
    return { ok: false, reason: result.reason, state: result.state }
  }

  runtime.enforcement.recordCommittedAction('pass')
  return {
    ok: true,
    state: result.state,
    notice: runtime.publishGameNotice(result.state),
  }
}

function runResign(args: unknown, runtime: GoToolRuntime): GoResignResult {
  const toolPath = 'go.resign'
  const record = readArguments(toolPath, args, ['gameId'])
  const gameId = readGameId(toolPath, record)

  const result = runtime.port.resign(gameId, GO_LANE_PLAYER)
  if (!result.ok) {
    return { ok: false, reason: result.reason, state: result.state }
  }

  runtime.enforcement.recordCommittedAction('resign')
  return {
    ok: true,
    state: result.state,
    outcome: result.outcome,
    notice: runtime.publishGameNotice(result.state),
  }
}

function runRequestDeepThink(args: unknown, runtime: GoToolRuntime): GoDeepThinkResult {
  readArguments('go.request_deep_think', args, [])
  runtime.enforcement.beginDeepThink()
  return { ok: true, requested: true, applied: false }
}

export const GO_TOOL_DEFINITIONS: readonly GoToolDefinition[] = Object.freeze([
  {
    name: 'go.state',
    description:
      'Read the authoritative game state: stones, side to play, move number, '
      + 'captures, last move and terminal outcome.',
    parameters: parameters({ gameId: GAME_ID_PROPERTY }, ['gameId']),
    run: runState,
  },
  {
    name: 'go.inspect_group',
    description:
      'Read the connected stones and liberties of the group at one intersection. '
      + 'Perception only; no life/death judgement.',
    parameters: parameters({ gameId: GAME_ID_PROPERTY, point: POINT_PROPERTY }, [
      'gameId',
      'point',
    ]),
    run: runInspectGroup,
  },
  {
    name: 'go.inspect_region',
    description:
      'Read the stones, empty intersections and liberties in a square region '
      + 'around one intersection.',
    parameters: parameters(
      { gameId: GAME_ID_PROPERTY, point: POINT_PROPERTY, radius: RADIUS_PROPERTY },
      ['gameId', 'point'],
    ),
    run: runInspectRegion,
  },
  {
    name: 'go.try_move',
    description:
      'Report what one placement would do locally: legality observable from the '
      + 'current board, stones it would capture and the resulting local liberties. '
      + 'The authoritative result still comes from go.play.',
    parameters: parameters({ gameId: GAME_ID_PROPERTY, point: POINT_PROPERTY }, [
      'gameId',
      'point',
    ]),
    run: runTryMove,
  },
  {
    name: 'go.play',
    description:
      'Commit a placement through the authoritative rules port. An illegal '
      + 'placement returns its rejection and changes nothing.',
    parameters: parameters({ gameId: GAME_ID_PROPERTY, point: POINT_PROPERTY }, [
      'gameId',
      'point',
    ]),
    run: runPlay,
  },
  {
    name: 'go.pass',
    description: 'Pass through the authoritative rules port.',
    parameters: parameters({ gameId: GAME_ID_PROPERTY }, ['gameId']),
    run: runPass,
  },
  {
    name: 'go.resign',
    description:
      'Resign through the authoritative rules port. The game ends immediately '
      + 'and the opponent wins by resignation.',
    parameters: parameters({ gameId: GAME_ID_PROPERTY }, ['gameId']),
    run: runResign,
  },
  {
    name: 'go.request_deep_think',
    description:
      'Request one bounded deep-think boost for this turn. Records the request; '
      + 'the boost policy decides whether to apply it.',
    parameters: parameters({}, []),
    run: runRequestDeepThink,
  },
])

export const GO_TOOL_NAMES: readonly GoToolPath[] = Object.freeze(
  GO_TOOL_DEFINITIONS.map(definition => definition.name),
)

export type GoToolRuntimeOptions = {
  readonly port: GoRulesPort
  readonly enforcement: GoTurnEnforcement
  readonly noticeSink?: GameNoticeSink
}

/**
 * Bind the per-turn dependencies the eight tools share.
 *
 * One runtime belongs to one Go turn, exactly like the C-T07 enforcement it
 * holds. The notice sequence is the publication order inside this runtime, so
 * a resign that does not advance the move number still supersedes the play
 * notice that preceded it.
 */
export function createGoToolRuntime(options: GoToolRuntimeOptions): GoToolRuntime {
  let sequence = 0

  const publishGameNotice = (state: GameState): GameNotice => {
    const notice = buildGameNotice(state)
    if (options.noticeSink !== undefined) {
      sequence += 1
      options.noticeSink.updateGame(notice, sequence)
    }
    return notice
  }

  return Object.freeze({
    port: options.port,
    enforcement: options.enforcement,
    publishGameNotice,
  })
}
