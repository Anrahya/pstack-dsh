import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('bundle composition', () => {
  it('is a server-only bundle installable with dsh plugin add from git', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name: string
      main: string
      scripts: Record<string, string>
      dsh: { bundle?: { patch?: string }; client?: unknown }
    }
    assert.equal(pkg.name, 'pstack-dsh')
    assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml')
    assert.equal(pkg.dsh.client, undefined)
    assert.equal(pkg.scripts.prepare, undefined)
    assert.equal(pkg.main, 'lib/index.js')
    const [host, patch] = await Promise.all([
      readFile(join(root, 'lib/index.js'), 'utf8'),
      readFile(join(root, 'cordis.patch.yml'), 'utf8'),
    ])
    assert.match(host, /function apply\(/)
    assert.match(host, /export \{[^}]*\bapply\b/)
    assert.match(patch, /id:\s*pstack-dsh/)
    assert.match(patch, /name:\s*pstack-dsh/)
  })

  it('ships no browser client and no settings route', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    assert.equal(pkg.exports['./client'], undefined)
    assert.equal(await exists(join(root, 'src/client')), false)
    assert.equal(await exists(join(root, 'src/settings-routes.ts')), false)
    assert.equal(await exists(join(root, 'lib/client.js')), false)
  })

  it('keeps the tool and skill registrations on the host half', async () => {
    const source = await readFile(join(root, 'src/index.ts'), 'utf8')
    assert.match(source, /ctx\.skills\.registerProvider/)
    for (const tool of ['catalogTool', 'overlayReadTool', 'overlayWriteTool', 'spawnTool']) {
      assert.match(source, new RegExp(`${tool}\\(host\\)`))
    }
    assert.doesNotMatch(source, /settings-routes|webServer|agent\/request/)
  })
})
