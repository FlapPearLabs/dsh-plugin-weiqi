/**
 * Local board perception for the Go tools (Spec §29 style, extended to one
 * region and to one candidate placement).
 *
 * This module never decides game truth: `go.try_move` reports what the current
 * authoritative board makes locally observable, and ko / positional superko
 * still belong to `GoRulesPort.play`.
 */
import type {
  BoardSize,
  BoardStone,
  GameState,
  Player,
  Point,
  StoneColor,
  GroupInfo,
} from '../../contracts/rules.js'
import type { GoLocalMoveObservation, GoRegionObservation } from './types.js'

const pointKey = (point: Point): string => `${point.x},${point.y}`

const copyPoint = (point: Point): Point => ({ x: point.x, y: point.y })

function inBoard(size: BoardSize, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < size && point.y < size
}

function neighbors(size: BoardSize, point: Point): Point[] {
  const candidates: Point[] = [
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 },
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
  ]
  return candidates.filter(candidate => inBoard(size, candidate))
}

function boardOf(state: GameState): Map<string, StoneColor> {
  return new Map(state.stones.map(stone => [pointKey(stone.point), stone.color]))
}

function collectGroup(
  board: ReadonlyMap<string, StoneColor>,
  size: BoardSize,
  start: Point,
): GroupInfo | null {
  const color = board.get(pointKey(start))
  if (color === undefined) return null

  const stones: Point[] = []
  const liberties: Point[] = []
  const seenStones = new Set<string>()
  const seenLiberties = new Set<string>()
  const pending: Point[] = [copyPoint(start)]
  seenStones.add(pointKey(start))

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    stones.push(current)
    for (const neighbor of neighbors(size, current)) {
      const key = pointKey(neighbor)
      const neighborColor = board.get(key)
      if (neighborColor === undefined) {
        if (!seenLiberties.has(key)) {
          seenLiberties.add(key)
          liberties.push(neighbor)
        }
        continue
      }
      if (neighborColor !== color || seenStones.has(key)) continue
      seenStones.add(key)
      pending.push(neighbor)
    }
  }

  return { point: copyPoint(start), color, stones, liberties }
}

/**
 * Observe one placement from the current board without mutating anything.
 *
 * Status, turn, board bounds and occupation are rejected first. The move is
 * then simulated on a local map so suicide and captures are reported exactly;
 * ko/superko need move history the port does not expose, so a locally legal
 * move is still subject to the authoritative `GoRulesPort.play` result.
 */
export function observeLocalMove(
  state: GameState,
  by: Player,
  point: Point,
): GoLocalMoveObservation {
  if (state.status === 'over') {
    return { legal: false, reason: 'game-over', captures: [], localLiberties: [] }
  }
  if (state.toPlay !== by) {
    return { legal: false, reason: 'out-of-turn', captures: [], localLiberties: [] }
  }
  if (!inBoard(state.boardSize, point)) {
    return { legal: false, reason: 'out-of-board', captures: [], localLiberties: [] }
  }

  const color = state.colors[by]
  const board = boardOf(state)
  if (board.has(pointKey(point))) {
    return { legal: false, reason: 'occupied', captures: [], localLiberties: [] }
  }
  board.set(pointKey(point), color)

  const captures: BoardStone[] = []
  for (const neighbor of neighbors(state.boardSize, point)) {
    const neighborColor = board.get(pointKey(neighbor))
    if (neighborColor === undefined || neighborColor === color) continue
    const group = collectGroup(board, state.boardSize, neighbor)
    if (group === null || group.liberties.length > 0) continue
    for (const stone of group.stones) {
      board.delete(pointKey(stone))
      captures.push({ point: copyPoint(stone), color: neighborColor })
    }
  }

  const ownGroup = collectGroup(board, state.boardSize, point)
  if (ownGroup === null || ownGroup.liberties.length === 0) {
    return { legal: false, reason: 'suicide', captures: [], localLiberties: [] }
  }

  return { legal: true, captures, localLiberties: ownGroup.liberties }
}

/** Stones, empty intersections and liberties inside one square board region. */
export function inspectRegion(
  state: GameState,
  center: Point,
  radius: number,
): GoRegionObservation {
  const board = boardOf(state)
  const stones: BoardStone[] = []
  const emptyPoints: Point[] = []
  const regionStoneKeys = new Set<string>()

  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      const point: Point = { x, y }
      if (!inBoard(state.boardSize, point)) continue
      const color = board.get(pointKey(point))
      if (color === undefined) {
        emptyPoints.push(point)
      } else {
        regionStoneKeys.add(pointKey(point))
        stones.push({ point, color })
      }
    }
  }

  const liberties = emptyPoints.filter(point =>
    neighbors(state.boardSize, point).some(neighbor => regionStoneKeys.has(pointKey(neighbor))),
  )

  return { center: copyPoint(center), radius, stones, emptyPoints, liberties }
}
