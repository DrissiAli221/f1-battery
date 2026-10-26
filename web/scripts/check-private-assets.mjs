// Warn (never fail) when a private asset is missing, so a public clone still builds with the OFL fallbacks.
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const list = readFileSync(resolve(root, 'web/private-assets.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
const missing = list.filter((p) => !existsSync(resolve(root, p)))
if (missing.length) {
  console.warn(
    `warning: ${missing.length} private asset(s) not present, building with fallbacks (run web/scripts/private-assets.sh pull):\n  ${missing.join('\n  ')}`,
  )
}
