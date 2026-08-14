import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const GENERATED_START = '<!-- BEGIN GENERATED ATHENA DIAGRAM MEDIA -->'
const GENERATED_END = '<!-- END GENERATED ATHENA DIAGRAM MEDIA -->'

const hash = (contents) => createHash('sha256').update(contents).digest('hex')

const assertManifest = (manifest) => {
  if (manifest?.schemaVersion !== 1 || manifest?.profile !== 'kwamina-fyi') {
    throw new Error('Expected a schemaVersion 1 kwamina-fyi diagram bundle')
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error('Diagram bundle contains no assets')
  }

  const themesByDiagram = new Map()
  const files = new Set()
  for (const asset of manifest.assets) {
    if (
      !asset ||
      typeof asset.diagramId !== 'string' ||
      typeof asset.file !== 'string' ||
      !/^[a-z0-9-]+-(light|dark)\.png$/.test(asset.file) ||
      basename(asset.file) !== asset.file ||
      !['light', 'dark'].includes(asset.theme) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    ) {
      throw new Error('Diagram bundle contains an invalid asset entry')
    }
    if (files.has(asset.file)) {
      throw new Error(`Diagram bundle repeats ${asset.file}`)
    }
    files.add(asset.file)
    const themes = themesByDiagram.get(asset.diagramId) ?? new Set()
    themes.add(asset.theme)
    themesByDiagram.set(asset.diagramId, themes)
  }

  for (const [diagramId, themes] of themesByDiagram) {
    if (!themes.has('light') || !themes.has('dark')) {
      throw new Error(`${diagramId} must include both light and dark assets`)
    }
  }
}

const evidenceBlock = (assets, reviewDate) => {
  const rows = assets
    .map((asset) => {
      const publicPath = `assets/athena-${asset.file}`
      const source = `Athena diagram source \`${asset.source}\`; \`kwamina-fyi\` profile`
      const provenance = `Generated ${asset.theme}-theme ${asset.diagramId} architecture diagram`
      return `| media | ${publicPath} | ${source} | ${asset.sha256} | ${provenance} | None — architecture labels only; no customer, staff, or account identifiers | No amounts, counts, or operational performance data | Playwright PNG export; SHA-256 verified during import | Diagram labels only | Codex (generated-artifact verification) | ${reviewDate} | approved |`
    })
    .join('\n')

  return `${GENERATED_START}\n\n### Generated architecture diagrams\n\n| Type | Public path | Source revision | SHA-256 | Provenance | Identifier/PII findings | Amount/count provenance | Metadata/profile status | Embedded-string scan | Reviewer | Review date | Decision |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows}\n\n${GENERATED_END}`
}

const replaceGeneratedEvidence = (ledger, block) => {
  const start = ledger.indexOf(GENERATED_START)
  const end = ledger.indexOf(GENERATED_END)
  if (start === -1 && end === -1) {
    return `${ledger.trimEnd()}\n\n${block}\n`
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Athena evidence ledger has a malformed generated diagram block')
  }
  return `${ledger.slice(0, start)}${block}${ledger.slice(end + GENERATED_END.length)}`
}

export const importDiagramBundle = async ({
  bundleDirectory,
  repoRoot,
  reviewDate = new Date().toISOString().slice(0, 10),
}) => {
  const bundleRoot = resolve(bundleDirectory)
  const manifest = JSON.parse(await readFile(join(bundleRoot, 'manifest.json'), 'utf8'))
  assertManifest(manifest)

  const canonicalDirectory = join(repoRoot, 'docs/content/assets')
  const publicDirectory = join(repoRoot, 'public/assets')
  await mkdir(canonicalDirectory, { recursive: true })
  await mkdir(publicDirectory, { recursive: true })

  for (const asset of manifest.assets) {
    const sourcePath = join(bundleRoot, asset.file)
    const contents = await readFile(sourcePath)
    if (hash(contents) !== asset.sha256) {
      throw new Error(`${asset.file} does not match its manifest hash`)
    }
    const destinationName = `athena-${asset.file}`
    await copyFile(sourcePath, join(canonicalDirectory, destinationName))
    await copyFile(sourcePath, join(publicDirectory, destinationName))
  }

  const ledgerPath = join(repoRoot, 'docs/content/work/athena/evidence.md')
  const ledger = await readFile(ledgerPath, 'utf8')
  await writeFile(
    ledgerPath,
    replaceGeneratedEvidence(ledger, evidenceBlock(manifest.assets, reviewDate)),
  )

  return manifest.assets.map(({ file }) => `athena-${file}`)
}
