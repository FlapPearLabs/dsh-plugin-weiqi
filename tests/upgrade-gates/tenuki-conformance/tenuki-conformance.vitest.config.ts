import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Dedicated vitest config for the WAVE-B-S01 tenuki conformance spike.
 *
 * The repo-level vitest.config.ts excludes tests/upgrade-gates/**; spike gates
 * run through their own runners (C-S01 / E-S01 precedent). This config makes
 * the tenuki conformance spec runnable from run-tenuki-conformance.sh without
 * touching the repo-level test surface.
 */
export default defineConfig({
  test: {
    include: ['tests/upgrade-gates/tenuki-conformance/**/*.spec.ts'],
    exclude: [...configDefaults.exclude],
  },
})
