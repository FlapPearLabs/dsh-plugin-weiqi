import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageName = '@flappearlabs/dsh-plugin-weiqi'
const pluginId = 'companion-go'
const dshSourceDir = requiredEnvironment('DSH_SOURCE_DIR')
const dshHome = requiredEnvironment('DSH_HOME')
const profileName = requiredEnvironment('DSH_PROFILE_NAME')
const profileDumpPath = requiredEnvironment('DSH_PROFILE_DUMP')

const appBootUrl = pathToFileURL(join(dshSourceDir, 'packages/boot/app-boot/lib/index.js')).href
const { boot, composeEntries, loadProfile } = await import(appBootUrl)
const installAnchor = join(dshSourceDir, 'apps/cli/package.json')
const profile = loadProfile('companion-go-profile-smoke', profileName, installAnchor, dshHome)
const profileManifest = JSON.parse(readFileSync(join(profile.dir, 'package.json'), 'utf8'))

assert.equal(typeof profileManifest.dependencies?.[packageName], 'string')
assert.ok(profileManifest.dsh?.profile?.bundles?.includes(packageName))
console.log(`TRACE profile dependency=${packageName}`)
console.log(`TRACE profile bundles=${profileManifest.dsh.profile.bundles.join(',')}`)

const layer = profile.layers.find(candidate => candidate.packageName === packageName)
assert.ok(layer, 'installed bundle must resolve to a profile layer')
assert.equal(layer.patchPath, join(layer.packageDir, 'cordis.patch.yml'))
console.log(`TRACE bundle layer patch=${layer.patchPath}`)

const entries = composeEntries([layer.patches])
assert.deepEqual(entries.map(entry => ({ id: entry.id, name: entry.name })), [
  { id: pluginId, name: packageName },
])

const dumpedProfile = readFileSync(profileDumpPath, 'utf8')
assert.match(dumpedProfile, /# == @flappearlabs\/dsh-plugin-weiqi/)
assert.match(dumpedProfile, /id: companion-go/)
assert.match(dumpedProfile, /name: '@flappearlabs\/dsh-plugin-weiqi'/)
console.log('TRACE profile composition contains bundle marker and Companion Go row')

// Mount the installed profile bundle beside the smallest real DSH core that
// provides AgentLoop's production factory boundary. Absolute host package
// paths keep the smoke independent of profile peer hoisting, while the
// Companion entry itself still resolves from the installed profile package.
const coreEntries = [
  ['llm', 'packages/llm/llm'],
  ['session', 'packages/core/session'],
  ['system-prompt', 'packages/core/system-prompt'],
  ['tools', 'packages/core/tools'],
  ['agent', 'packages/core/agent'],
  ['agent-loop', 'packages/core/agent-loop', { agents: [] }],
].map(([id, packagePath, config]) => ({
  id,
  name: join(dshSourceDir, packagePath, 'lib/index.js'),
  ...(config === undefined ? {} : { config }),
}))
const smokeConfigPath = join(profile.dir, 'agent-loop-smoke-root.json')
writeFileSync(smokeConfigPath, JSON.stringify(coreEntries, null, 2) + '\n')
const ctx = await boot('companion-go-profile-smoke', smokeConfigPath, structuredClone(layer.patches))

try {
  const loaderEntries = [...ctx.loader.entries()]
  assert.deepEqual(loaderEntries.map(entry => entry.options.id), [
    'include',
    ...coreEntries.map(entry => entry.id),
    pluginId,
  ])
  const pluginEntry = loaderEntries.find(entry => entry.options.id === pluginId)
  assert.ok(pluginEntry, 'Companion Go row must be present in the mounted Loader tree')
  assert.equal(pluginEntry.options.name, packageName)
  assert.ok(pluginEntry.fiber, 'Companion Go Loader entry must have an active fiber')
  assert.equal(pluginEntry.fiber.name, pluginId)

  const forbiddenEntryIds = [
    'companion-go-runtime',
    'companion-go-tools',
    'companion-go-ui',
    'companion-go-tenuki',
  ]
  assert.equal(loaderEntries.some(entry => forbiddenEntryIds.includes(entry.options.id)), false)

  const workAgent = ctx.agents.get('companion-go-work')
  const goAgent = ctx.agents.get('companion-go-go')
  const workSession = ctx.sessions.get('companion-go-work')
  const goSession = ctx.sessions.get('companion-go-go')
  assert.ok(workAgent, 'work Agent must be materialized by the real AgentLoop')
  assert.ok(goAgent, 'go Agent must be materialized by the real AgentLoop')
  assert.ok(workSession, 'work Session must be live in SessionStore')
  assert.ok(goSession, 'go Session must be live in SessionStore')
  assert.equal(workAgent.session, workSession)
  assert.equal(goAgent.session, goSession)
  assert.notEqual(workAgent, goAgent)
  assert.notEqual(workSession, goSession)
  assert.deepEqual(ctx.agents.list().map(agent => agent.id).sort(), [
    'companion-go-go',
    'companion-go-work',
  ])
  assert.deepEqual(ctx.sessions.list().map(session => session.id).sort(), [
    'companion-go-go',
    'companion-go-work',
  ])

  console.log(`TRACE loader entries=${loaderEntries.map(entry => entry.options.id).join(',')}`)
  console.log(`TRACE plugin fiber=${pluginEntry.fiber.name} status=mounted`)
  console.log('TRACE AgentLoop pairs=companion-go-work,companion-go-go status=live-isolated')
} finally {
  await ctx.fiber.dispose()
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`Missing ${name}`)
  return value
}
