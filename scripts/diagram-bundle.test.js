import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { importDiagramBundle } from './diagram-bundle.mjs'

const sha256 = (contents) => createHash('sha256').update(contents).digest('hex')

const fixture = async ({ corrupt = false } = {}) => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'kwamina-fyi-diagram-import-'))
  const bundleDirectory = join(repoRoot, 'bundle')
  await mkdir(bundleDirectory)
  await mkdir(join(repoRoot, 'docs/content/work/athena'), { recursive: true })
  await writeFile(join(repoRoot, 'docs/content/work/athena/evidence.md'), '# Evidence\n')

  const assets = []
  for (const theme of ['light', 'dark']) {
    const file = `system-overview-${theme}.png`
    const contents = Buffer.from(`png-${theme}`)
    await writeFile(join(bundleDirectory, file), contents)
    assets.push({
      diagramId: 'system-overview',
      file,
      profile: 'kwamina-fyi',
      source: 'architecture.html',
      theme,
      sha256: corrupt && theme === 'dark' ? '0'.repeat(64) : sha256(contents),
      width: 100,
      height: 50,
    })
  }
  await writeFile(
    join(bundleDirectory, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, profile: 'kwamina-fyi', scale: 2, assets }),
  )
  return { bundleDirectory, repoRoot }
}

describe('Athena diagram bundle import', () => {
  test('installs verified theme pairs and records reviewed media', async () => {
    const paths = await fixture()
    const imported = await importDiagramBundle({ ...paths, reviewDate: '2026-08-14' })

    expect(imported).toEqual([
      'athena-system-overview-light.png',
      'athena-system-overview-dark.png',
    ])
    const canonical = await readFile(
      join(paths.repoRoot, 'docs/content/assets/athena-system-overview-light.png'),
    )
    const published = await readFile(
      join(paths.repoRoot, 'public/assets/athena-system-overview-light.png'),
    )
    expect(published).toEqual(canonical)
    const ledger = await readFile(
      join(paths.repoRoot, 'docs/content/work/athena/evidence.md'),
      'utf8',
    )
    expect(ledger).toContain('assets/athena-system-overview-light.png')
    expect(ledger).toContain('2026-08-14 | approved')
  })

  test('rejects an asset whose content does not match the manifest', async () => {
    const paths = await fixture({ corrupt: true })
    await expect(importDiagramBundle(paths)).rejects.toThrow(
      'does not match its manifest hash',
    )
  })
})
