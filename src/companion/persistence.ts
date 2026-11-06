import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CompanionState } from '../contracts/companion.js'

const STORE_VERSION = 1

type LatestCompanionStateFile<TCompiledPersona, TMoodState> = {
  version: typeof STORE_VERSION
  state: CompanionState<TCompiledPersona, TMoodState>
}

/**
 * Latest-only snapshot: temp file plus rename avoids truncating the previous
 * snapshot on a crash mid-write, and no journal file is produced.
 */
export async function saveLatestCompanionState<TCompiledPersona, TMoodState>(
  filePath: string,
  state: CompanionState<TCompiledPersona, TMoodState>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })

  const payload: LatestCompanionStateFile<TCompiledPersona, TMoodState> = {
    version: STORE_VERSION,
    state,
  }
  const temporaryPath = `${filePath}.tmp`

  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}

export async function loadLatestCompanionState<TCompiledPersona, TMoodState>(
  filePath: string,
): Promise<CompanionState<TCompiledPersona, TMoodState> | undefined> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }

  const payload = JSON.parse(raw) as LatestCompanionStateFile<TCompiledPersona, TMoodState>
  if (payload.version !== STORE_VERSION) {
    throw new Error(`unsupported CompanionState store version: ${String(payload.version)}`)
  }

  return payload.state
}
