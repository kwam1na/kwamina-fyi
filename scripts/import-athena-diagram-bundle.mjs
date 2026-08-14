import { resolve } from 'node:path'

import { importDiagramBundle } from './diagram-bundle.mjs'

const bundleDirectory = process.argv[2]
if (!bundleDirectory) {
  throw new Error('Usage: bun run diagrams:import -- /path/to/diagram-bundle')
}

const repoRoot = resolve(import.meta.dirname, '..')
const imported = await importDiagramBundle({ bundleDirectory, repoRoot })
console.log(`Imported ${imported.length} Athena diagram assets`)
