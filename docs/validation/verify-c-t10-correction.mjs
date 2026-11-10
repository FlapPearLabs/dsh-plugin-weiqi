#!/usr/bin/env node
// Read-only verification for docs/validation/C-T10-LIVE-CALIBRATION-CORRECTION.md.
//
// Usage: node docs/validation/verify-c-t10-correction.mjs
//
// Reads only committed datasets; sends no request and writes no file.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const ROUND1_PATH = 'docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-RAW-run1-4000cap.json'
const ROUND2_PATH = 'docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-RAW-run2-16000cfg-8192eff.json'
const ROUND1_SHA256 = '4c05ada4a649de3db33893e761abc6add0452a26cd04f1ce0da00ab4e6891175'
const ROUND2_SHA256 = '929981c3ca51e9d98901e13983706a8dbebdeb7697fbd536a6f24146aa4a5741'

const TRANSPORT_RE = /made (\d+) transport attempts for (\d+) admitted requests/

function transportCounter (dataset, turnId) {
  const turn = dataset.turns.find(item => item.id === turnId)
  const match = TRANSPORT_RE.exec(turn?.error ?? '')
  return match === null
    ? null
    : { attempts: Number(match[1]), admitted: Number(match[2]) }
}

function summarize (path) {
  const bytes = readFileSync(path)
  const dataset = JSON.parse(bytes.toString('utf8'))
  const gate = dataset.session.gate
  const requests = dataset.requests
  const classes = {}
  for (const turn of dataset.turns) {
    const error = turn.error ?? ''
    const kind = turn.outcome === 'completed'
      ? 'completed'
      : error.includes('enforcement bypass')
        ? 'retryGuardFalsePositive'
        : error.includes('maxModelSteps')
          ? 'stepExhausted'
          : error.includes('provider call failed')
            ? 'network'
            : 'other'
    classes[kind] = (classes[kind] ?? 0) + 1
  }
  const settledThroughT23 = requests.filter(request => request.turnId <= 'T23').length
  const t23 = transportCounter(dataset, 'T23')
  const t24 = transportCounter(dataset, 'T24')
  // Check adapter-call accounting, not HTTP-client-internal retries.
  // The failed-turn retryAttempts field is a literal 0, not a counter.
  const adapterCallAccountingConsistent = t24 !== null
    ? t24.attempts === gate.requests
    : t23 !== null &&
      t23.attempts === settledThroughT23 &&
      settledThroughT23 + requests.filter(request => request.turnId === 'T24').length +
        gate.unsettledRequests === gate.requests
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    dispatched: gate.requests,
    settled: requests.length,
    unsettled: gate.unsettledRequests,
    http200: requests.filter(request => request.httpStatus === 200).length,
    turns: dataset.turns.length,
    completed: dataset.turns.filter(turn => turn.outcome === 'completed').length,
    failed: dataset.turns.filter(turn => turn.outcome === 'failed').length,
    classes,
    atRequestedCap: requests.filter(request =>
      request.usage.outputTokens === request.requestedMaxTokens).length,
    finishLength: requests.filter(request => request.finishReason === 'length').length,
    lengthAndAtCap: requests.filter(request => request.finishReason === 'length' &&
      request.usage.outputTokens === request.requestedMaxTokens).length,
    lengthNotAtCap: requests.filter(request => request.finishReason === 'length' &&
      request.usage.outputTokens !== request.requestedMaxTokens).length,
    requestedMaxTokens: [...new Set(requests.map(request => request.requestedMaxTokens))].sort((a, b) => a - b),
    capsMaxOutputTokensPerRequest: dataset.caps.maxOutputTokensPerRequest,
    turnBudgetPerRequestMaxTokens: dataset.turnBudget.perRequestMaxTokens,
    turnBudgetMaxModelSteps: dataset.turnBudget.maxModelSteps,
    retryAttemptsAllZero: dataset.turns.every(turn => turn.retryAttempts === 0),
    zeroUsageRows: requests.filter(request =>
      request.usage.outputTokens === 0 || request.usage.inputTokens === 0).length,
    settledThroughT23,
    transportT02: transportCounter(dataset, 'T02'),
    transportT23: t23,
    transportT24: t24,
    adapterCallAccountingConsistent,
    rawCacheHitPresent: requests.filter(request =>
      request.rawUsage?.prompt_tokens_details?.cached_tokens !== undefined).length,
    reportedModels: [...new Set(requests.map(request => request.reportedModel))].sort(),
    estimatedCostCny: gate.estimatedCostCny,
    unsettledCostCny: gate.unsettledCostCny,
  }
}

const EXPECTED = {
  [ROUND1_PATH]: {
    sha256: ROUND1_SHA256,
    dispatched: 80,
    settled: 77,
    unsettled: 3,
    http200: 77,
    turns: 24,
    completed: 1,
    failed: 23,
    classes: { completed: 1, retryGuardFalsePositive: 17, stepExhausted: 3, network: 3 },
    atRequestedCap: 16,
    finishLength: 16,
    lengthAndAtCap: 16,
    lengthNotAtCap: 0,
    requestedMaxTokens: [4000],
    capsMaxOutputTokensPerRequest: 4000,
    turnBudgetPerRequestMaxTokens: 4000,
    turnBudgetMaxModelSteps: 6,
    retryAttemptsAllZero: true,
    zeroUsageRows: 0,
    settledThroughT23: 74,
    transportT02: { attempts: 7, admitted: 4 },
    transportT23: { attempts: 77, admitted: 3 },
    transportT24: { attempts: 80, admitted: 3 },
    adapterCallAccountingConsistent: true,
    rawCacheHitPresent: 77,
    reportedModels: ['deepseek-v4.1-flash'],
    estimatedCostCny: 0.9062867136,
    unsettledCostCny: 0.11683476,
  },
  [ROUND2_PATH]: {
    sha256: ROUND2_SHA256,
    dispatched: 80,
    settled: 79,
    unsettled: 1,
    http200: 79,
    turns: 24,
    completed: 1,
    failed: 23,
    classes: { completed: 1, retryGuardFalsePositive: 22, network: 1 },
    atRequestedCap: 7,
    finishLength: 7,
    lengthAndAtCap: 7,
    lengthNotAtCap: 0,
    requestedMaxTokens: [8192],
    capsMaxOutputTokensPerRequest: 16000,
    turnBudgetPerRequestMaxTokens: 16000,
    turnBudgetMaxModelSteps: 10,
    retryAttemptsAllZero: true,
    zeroUsageRows: 0,
    settledThroughT23: 78,
    transportT02: { attempts: 8, admitted: 3 },
    transportT23: { attempts: 78, admitted: 4 },
    transportT24: null,
    adapterCallAccountingConsistent: true,
    rawCacheHitPresent: 79,
    reportedModels: ['deepseek-v4.1-flash'],
    estimatedCostCny: 1.3922687064,
    unsettledCostCny: 0.07501647,
  },
}

let failed = false
for (const [path, expected] of Object.entries(EXPECTED)) {
  let datasetFailed = false
  console.log(`\n${path}`)
  try {
    const actual = summarize(path)
    console.log(JSON.stringify(actual, null, 2))
    for (const [key, value] of Object.entries(expected)) {
      const same = JSON.stringify(actual[key]) === JSON.stringify(value)
      if (!same) {
        datasetFailed = true
        console.error(`MISMATCH ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`)
      }
    }
  } catch (error) {
    datasetFailed = true
    console.error(`DATASET ERROR: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`assertions: ${datasetFailed ? 'FAIL' : 'PASS'}`)
  if (datasetFailed) failed = true
}
process.exit(failed ? 1 : 0)
