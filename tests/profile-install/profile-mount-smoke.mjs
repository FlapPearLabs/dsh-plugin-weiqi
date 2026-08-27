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

const smokeConfigPath = join(profile.dir, 'foundation-smoke-root.yml')
writeFileSync(smokeConfigPath, '[]\n')
const ctx = await boot('companion-go-profile-smoke', smokeConfigPath, structuredClone(layer.patches))

try {
  const loaderEntries = [...ctx.loader.entries()]
  assert.deepEqual(loaderEntries.map(entry => entry.options.id), ['include', pluginId])
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

  console.log(`TRACE loader entries=${loaderEntries.map(entry => entry.options.id).join(',')}`)
  console.log(`TRACE plugin fiber=${pluginEntry.fiber.name} status=mounted`)
  console.log('TRACE Phase A product entries=0')
} finally {
  await ctx.fiber.dispose()
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`Missing ${name}`)
  return value
}
