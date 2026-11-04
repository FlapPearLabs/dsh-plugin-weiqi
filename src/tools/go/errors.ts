/** Deterministic refusals at the Go tool boundary. */

/** Raised when model-supplied arguments violate a tool's declared schema. */
export class GoToolArgumentError extends Error {
  constructor(
    readonly toolPath: string,
    readonly detail: string,
  ) {
    super(`${toolPath}: ${detail}`)
    this.name = 'GoToolArgumentError'
  }
}

export type GoToolSurfaceIssue =
  | {
      readonly reason: 'duplicate-path'
      readonly toolPath: string
      readonly missing: readonly string[]
      readonly extra: readonly string[]
    }
  | {
      readonly reason: 'surface-mismatch'
      readonly missing: readonly string[]
      readonly extra: readonly string[]
    }

/** Raised when a tool set is not exactly the eight Spec §20 Phase A paths. */
export class GoToolSurfaceError extends Error {
  readonly reason: GoToolSurfaceIssue['reason']
  readonly toolPath: string | undefined
  readonly missing: readonly string[]
  readonly extra: readonly string[]

  constructor(issue: GoToolSurfaceIssue) {
    super(
      issue.reason === 'duplicate-path'
        ? `Go tool surface repeats ${issue.toolPath}`
        : `Go tool surface is not the eight Spec §20 paths: `
          + `missing [${issue.missing.join(', ')}], extra [${issue.extra.join(', ')}]`,
    )
    this.name = 'GoToolSurfaceError'
    this.reason = issue.reason
    this.toolPath = issue.reason === 'duplicate-path' ? issue.toolPath : undefined
    this.missing = issue.missing
    this.extra = issue.extra
  }
}
