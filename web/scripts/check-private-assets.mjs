// Warn (never fail) when a private asset is missing, so a public clone still builds with the OFL fallbacks.
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Paths in the list are repo-relative (web/public/...); resolve them from the web folder so the
// check also works when only web/ is mounted into the build container.
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const list = readFileSync(resolve(webDir, 'private-assets.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
const missing = list.filter((p) => !existsSync(resolve(webDir, p.replace(/^web\//, ''))))
if (missing.length) {
  console.warn(
    `warning: ${missing.length} private asset(s) not present, building with fallbacks (run web/scripts/private-assets.sh pull):\n  ${missing.join('\n  ')}`,
  )
}
