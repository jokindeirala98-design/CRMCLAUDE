import ExcelJS from 'exceljs'
import fs from 'fs'

const buf = fs.readFileSync('/sessions/hopeful-funny-gates/mnt/uploads/rrrr.xls')
console.log('Bytes:', buf.length)
console.log('Header (hex):', buf.slice(0, 8).toString('hex'))
console.log('Header (ascii):', JSON.stringify(buf.slice(0, 8).toString('ascii').replace(/[^\x20-\x7e]/g, '·')))

// Replicar lo que hace ImportConsumptionModal.tsx
const wb = new ExcelJS.Workbook()
try {
  await wb.xlsx.load(buf)
  console.log('xlsx.load: OK')
  console.log('Worksheets:', wb.worksheets.map(w => w.name))
  if (wb.worksheets[0]) {
    const ws = wb.worksheets[0]
    console.log('rowCount:', ws.rowCount, 'colCount:', ws.columnCount)
    const headers = []
    ws.getRow(1).eachCell((c, col) => headers[col] = String(c.value ?? ''))
    console.log('Header row 1:', headers.filter(Boolean))
  }
} catch (e) {
  console.log('xlsx.load FAIL:', e.message)
}
