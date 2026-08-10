import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

let scratchDirectory

afterEach(async () => {
  if (scratchDirectory) await rm(scratchDirectory, { recursive: true, force: true })
  scratchDirectory = undefined
})

describe('set-pdf-title', () => {
  it('writes the title and author without changing the page count', async () => {
    scratchDirectory = await mkdtemp(join(tmpdir(), 'kwamina-resume-title-'))
    const pdfPath = join(scratchDirectory, 'resume.pdf')
    const source = await PDFDocument.create()
    source.addPage()
    await writeFile(pdfPath, await source.save())

    const result = Bun.spawnSync([
      'node',
      'scripts/set-pdf-title.mjs',
      pdfPath,
      'Resume — Kwamina Essuah Mensah',
    ])

    expect(result.exitCode).toBe(0)
    const output = await PDFDocument.load(await readFile(pdfPath))
    expect(output.getTitle()).toBe('Resume — Kwamina Essuah Mensah')
    expect(output.getAuthor()).toBe('Kwamina Essuah Mensah')
    expect(output.getPageCount()).toBe(1)
  })
})
