import fs from 'fs'
// xlsx no está instalado, vemos si existe
try {
  const xlsx = await import('xlsx')
  const wb = xlsx.read(fs.readFileSync('/sessions/hopeful-funny-gates/mnt/uploads/rrrr.xls'), { type: 'buffer' })
  console.log('xlsx.read OK. Hojas:', wb.SheetNames)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = xlsx.utils.sheet_to_json(ws)
  console.log('Filas:', data.length)
  console.log('Primera fila:', data[0])
} catch (e) {
  console.log('xlsx NO instalado:', e.message)
}
