import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const HARNESS = '0.2.1-rc.3'
const RANGE = '>=0.2.1-rc.1 <0.3.0'

describe('DSH 0.2.1 peers', () => {
  it('accepts 0.2.1-rc.3 and rejects the previous 0.2.0 line', async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
      engines?: { dsh?: string }
    }
    const peers = Object.entries(manifest.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    assert.ok(peers.length > 0)
    for (const [name, range] of peers) {
      assert.equal(range, RANGE, name)
      assert.equal(semver.satisfies(HARNESS, range), true, `${name} must accept ${HARNESS}`)
      assert.equal(semver.satisfies('0.2.0-rc.2', range), false, `${name} must reject 0.2.0-rc.2`)
      assert.equal(semver.satisfies('0.2.0-alpha.1', range), false, `${name} must reject 0.2.0 alphas`)
      assert.match(manifest.devDependencies[name], /^0\.2\.1-rc\.3$/, name)
    }
    assert.equal(manifest.engines?.dsh, RANGE)
  })
})
