// Run every check in one command: `node tools/run-all.mjs`.
//
// Each suite is a separate process because they disagree about nothing except
// argv, and a fresh process keeps one suite's failure from masking another's.
// Exit code is non-zero if any suite fails, so this doubles as the CI gate.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const client = join(root, 'client.js')
const host = join(root, 'index.js')

/** [suite file, argv after the script, one-line description]. */
const SUITES = [
  ['check-keys.js', [client], 'translation keys match both dictionaries'],
  ['test-icons.cjs', [client, host], 'glyph vocabulary and palette parity'],
  ['test-render.cjs', [client, host], 'every tab renders, seats and spinner included'],
  ['test-layout.cjs', [client], 'row geometry, tones and the running spinner'],
  ['test-folds.cjs', [client], 'category and workspace folding'],
  ['test-gestures.cjs', [client], 'long-press drag and reordering'],
  ['test-regressions.cjs', [client], 'document helpers and normalisation'],
  ['test-host.mjs', [], 'Host route, validation and atomic writes'],
]

const failed = []
for (const [file, args, description] of SUITES) {
  const label = file.padEnd(22)
  const result = spawnSync(process.execPath, [join(here, file), ...args], {
    encoding: 'utf8',
    cwd: root,
  })
  const ok = result.status === 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${description}`)
  if (!ok) {
    failed.push(file)
    /* Surface the failing suite's own output; its first lines name the check. */
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim()
    if (detail !== '') {
      for (const line of detail.split(/\r?\n/).slice(0, 20)) console.log('        ' + line)
    } else {
      console.log('        (no output; exit ' + result.status + ')')
    }
  }
}

console.log('')
if (failed.length === 0) {
  console.log(`All ${SUITES.length} suites passed.`)
} else {
  console.log(`${failed.length} of ${SUITES.length} suites failed: ${failed.join(', ')}`)
  process.exitCode = 1
}
