import { readFile, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'

const [pdfPath, title] = process.argv.slice(2)

if (!pdfPath || !title) {
  console.error('Usage: node scripts/set-pdf-title.mjs <pdf-path> <title>')
  process.exit(64)
}

const pdf = await PDFDocument.load(await readFile(pdfPath))
pdf.setTitle(title)
pdf.setAuthor('Kwamina Essuah Mensah')
await writeFile(pdfPath, await pdf.save())
