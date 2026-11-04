declare module 'tenuki' {
  export type TenukiColor = 'black' | 'white'

  export interface TenukiPoint {
    readonly y: number
    readonly x: number
  }

  export interface TenukiIntersection {
    readonly y: number
    readonly x: number
    isEmpty(): boolean
    isBlack(): boolean
    isWhite(): boolean
    isOccupiedWith(color: TenukiColor): boolean
  }

  export interface TenukiBoardState {
    readonly moveNumber: number
    readonly playedPoint: TenukiPoint | null
    readonly color: TenukiColor
    readonly pass: boolean
    readonly blackStonesCaptured: number
    readonly whiteStonesCaptured: number
    intersectionAt(y: number, x: number): TenukiIntersection
    playAt(y: number, x: number, color: TenukiColor): TenukiBoardState
    libertiesAt(y: number, x: number): number
  }

  export interface TenukiGameOptions {
    boardSize?: number
    scoring?: 'area' | 'territory' | 'equivalence'
    koRule?: 'simple' | 'positional-superko' | 'situational-superko' | 'natural-situational-superko'
    komi?: number
  }

  export class Game {
    constructor(options?: TenukiGameOptions)
    readonly boardSize: number
    currentPlayer(): TenukiColor
    moveNumber(): number
    intersections(): readonly TenukiIntersection[]
    intersectionAt(y: number, x: number): TenukiIntersection
    currentState(): TenukiBoardState
    isOver(): boolean
    playAt(y: number, x: number, options?: { readonly render?: boolean }): boolean
    pass(options?: { readonly render?: boolean }): boolean
    isIllegalAt(y: number, x: number): boolean
    score(): { readonly black: number; readonly white: number }
    deadStones(): readonly TenukiPoint[]
    markDeadAt(y: number, x: number, options?: { readonly render?: boolean }): boolean
  }
}
