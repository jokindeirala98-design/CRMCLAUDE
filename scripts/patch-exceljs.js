/**
 * Patches ExcelJS 4.4.0 to handle Excel files with images/drawings
 * that have missing or undefined drawing data (e.g. templates with logos).
 *
 * Run automatically via "postinstall" in package.json.
 */

const fs = require('fs')
const path = require('path')

const patches = [
  {
    file: 'node_modules/exceljs/lib/xlsx/xlsx.js',
    find: 'const drawing = model.drawings[name];\n      const drawingRel = model.drawingRels[name];\n      if (drawingRel) {',
    replace: 'const drawing = model.drawings[name];\n      const drawingRel = model.drawingRels[name];\n      if (drawingRel && drawing) {',
    description: 'null-check drawing in XLSX reconcile',
  },
  {
    file: 'node_modules/exceljs/lib/xlsx/xform/sheet/worksheet-xform.js',
    find: '        const drawing = options.drawings[drawingName];\n        drawing.anchors.forEach(anchor => {',
    replace: '        const drawing = options.drawings[drawingName];\n        if (!drawing || !drawing.anchors) { return; }\n        drawing.anchors.forEach(anchor => {',
    description: 'null-check drawing.anchors in WorkSheetXform',
  },
  {
    file: 'node_modules/exceljs/lib/doc/worksheet.js',
    find: 'this.tables = value.tables.reduce((tables, table) => {',
    replace: 'this.tables = (value.tables || []).reduce((tables, table) => {',
    description: 'null-check value.tables in Worksheet model setter',
  },
]

let applied = 0
let skipped = 0

for (const patch of patches) {
  const filePath = path.join(__dirname, '..', patch.file)
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-exceljs] SKIP (file not found): ${patch.file}`)
    skipped++
    continue
  }
  const src = fs.readFileSync(filePath, 'utf8')
  if (src.includes(patch.replace)) {
    // Already patched
    skipped++
    continue
  }
  if (!src.includes(patch.find)) {
    console.log(`[patch-exceljs] SKIP (pattern not found): ${patch.description}`)
    skipped++
    continue
  }
  fs.writeFileSync(filePath, src.replace(patch.find, patch.replace))
  console.log(`[patch-exceljs] Applied: ${patch.description}`)
  applied++
}

if (applied > 0) {
  console.log(`[patch-exceljs] Done — ${applied} patch(es) applied, ${skipped} already applied/skipped.`)
} else {
  console.log(`[patch-exceljs] All patches already applied (${skipped} skipped).`)
}
