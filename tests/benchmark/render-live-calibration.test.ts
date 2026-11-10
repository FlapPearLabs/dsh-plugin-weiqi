import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { it } from 'vitest'
import {
  deriveCalibrationRecommendation,
  renderCalibrationReport,
  summarizeCalibration,
  type CalibrationDataset,
} from './live-calibration.js'

const ENABLED = process.env.C_T10_RENDER_REPORT === '1'
const RAW = 'docs/validation/C-T10-LIVE-CALIBRATION-RAW.json'
const REPORT = 'docs/validation/C-T10-LIVE-CALIBRATION.md'

it.runIf(ENABLED)('re-renders the calibration report from the recorded raw dataset', () => {
  const dataset = JSON.parse(
    readFileSync(resolve(process.cwd(), RAW), 'utf8'),
  ) as CalibrationDataset
  const summary = summarizeCalibration(dataset)
  const report = renderCalibrationReport(
    dataset,
    summary,
    deriveCalibrationRecommendation(dataset, summary),
  )
  writeFileSync(resolve(process.cwd(), REPORT), report, 'utf8')
})
