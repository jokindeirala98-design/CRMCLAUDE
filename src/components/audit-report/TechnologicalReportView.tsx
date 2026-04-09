'use client'

import { 
  Zap, Flame, BarChart3, Printer, Edit3, Save, Globe, ShieldCheck, Cpu,
  CheckCircle2
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ConsumptionSnapshot, AuditReport } from '@/types/database'
import { 
  formatKWh, formatNumber, rowTotal, classifyRows, totalConsumption, periodTotals,
  PERIOD_COLORS 
} from '@/lib/consumption-utils'

// ─── SVG Donut Chart ────────────────────────────────────────────────────────
function DonutChart({ data, colors, size = 200, strokeWidth = 40 }: {
  data: { label: string; value: number }[]
  colors: string[]
  size?: number
  strokeWidth?: number
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null
  const radius = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  let cumulative = 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.filter(d => d.value > 0).map((d, i) => {
        const pct = d.value / total
        const dash = circumference * pct
        const gap = circumference - dash
        const offset = circumference * cumulative
        cumulative += pct
        return (
          <circle
            key={d.label}
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray 0.3s' }}
          />
        )
      })}
      <text x={cx} y={cy - 8} textAnchor="middle" className="fill-slate-900 text-lg font-bold">{formatNumber(total)}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="fill-slate-400 text-[10px]">kWh/año</text>
    </svg>
  )
}

function SectionTitle({ num, title, subtitle }: { num: number | string; title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-lg bg-blue-900 text-white flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>{num}</span>
        <h2 className="font-display font-bold text-lg text-slate-900">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-slate-400 mt-1 ml-10">{subtitle}</p>}
    </div>
  )
}

interface TechnologicalReportViewProps {
  rows: ConsumptionSnapshot[]
  client: any
  report: AuditReport | null
  informeBreve: string
  setInformeBreve: (s: string) => void
  isEditing: boolean
  setIsEditing: (b: boolean) => void
  onSave: () => Promise<void>
  saving: boolean
  saved: boolean
  onPrint: () => void
  onBackToTable?: () => void
}

export function TechnologicalReportView({
  rows,
  client,
  report,
  informeBreve,
  setInformeBreve,
  isEditing,
  setIsEditing,
  onSave,
  saving,
  saved,
  onPrint,
  onBackToTable
}: TechnologicalReportViewProps) {
  
  const reportRows = (report?.rows_snapshot) ? report.rows_snapshot as ConsumptionSnapshot[] : rows
  const reportClassified = classifyRows(reportRows)
  const totals = periodTotals(reportClassified.electricity)
  const grandTotal = totalConsumption(reportRows)
  const generatedAt = report?.created_at ? new Date(report.created_at) : new Date()

  return (
    <div className="min-h-screen bg-surface-container-low text-on-surface">
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md border-b border-outline-variant/10 shadow-ambient-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {onBackToTable && (
              <Button variant="ghost" size="sm" onClick={onBackToTable} className="hover:bg-primary/10">
                <span className="text-sm font-semibold">Volver a la tabla</span>
              </Button>
            )}
            <div className="h-4 w-[1px] bg-outline-variant/30 hidden sm:block" />
            <span className="text-sm font-bold tracking-tight truncate max-w-[200px] sm:max-w-none">
              {report?.title || 'Informe Auditoria Energetica'}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1.5 text-[10px] text-success font-bold uppercase tracking-wider bg-success/10 px-2 py-1 rounded-full">
                <CheckCircle2 className="w-3 h-3" /> Guardado
              </span>
            )}
            <div className="flex bg-surface-container-high rounded-xl p-1 shadow-inner">
              <Button 
                size="sm" 
                variant={isEditing ? 'primary' : 'ghost'} 
                onClick={() => isEditing ? onSave() : setIsEditing(true)}
                loading={saving}
                className="rounded-lg h-8 px-3"
              >
                {isEditing ? <><Save className="w-3.5 h-3.5 mr-1" /> Guardar</> : <><Edit3 className="w-3.5 h-3.5 mr-1" /> Editar</>}
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={onPrint}
                className="rounded-lg h-8 px-3 hover:bg-primary/10"
              >
                <Printer className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Imprimir PDF</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Report document */}
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div id="audit-report" className="tech-card bg-surface-container-lowest overflow-hidden shadow-ambient-2xl border border-outline-variant/10 rounded-[2.5rem] relative">
          
          <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-gradient-to-bl from-primary/5 to-transparent pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-secondary/5 rounded-full blur-3xl pointer-events-none" />

          {/* ════ PORTADA (COVER) ════ */}
          <div className="relative pt-24 pb-16 px-12 text-center border-b border-outline-variant/10 overflow-hidden">
            <div className="absolute top-12 left-1/2 -translate-x-1/2 opacity-10">
               <Cpu className="w-64 h-64 text-primary" strokeWidth={0.5} />
            </div>
            
            <div className="relative z-10 space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-gradient-to-tr from-primary to-primary-container rounded-3xl flex items-center justify-center shadow-lg shadow-primary/20 rotate-3 transition-transform duration-500">
                  <Zap className="w-10 h-10 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black tracking-[0.3em] uppercase text-primary/70">ESTUDIO TÉCNICO ENERGÉTICO</p>
                <h1 className="font-display text-5xl font-black text-on-surface tracking-tight">
                  {client?.name}
                </h1>
              </div>

              <div className="w-16 h-1 bg-primary/20 mx-auto rounded-full" />

              <p className="text-sm font-medium text-on-surface-variant max-w-md mx-auto leading-relaxed">
                Análisis exhaustivo de la red de suministros {client?.type === 'ayuntamiento' ? 'municipales' : 'corporativos'} para la optimización de potencias y consumos.
              </p>

              <div className="grid grid-cols-4 gap-4 max-w-3xl mx-auto mt-12 bg-surface-container-low/50 backdrop-blur-sm p-8 rounded-3xl border border-outline-variant/10">
                <div className="text-center space-y-1">
                  <p className="text-3xl font-black text-primary">{reportRows.length}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Suministros</p>
                </div>
                <div className="text-center space-y-1 border-x border-outline-variant/10">
                  <p className="text-3xl font-black text-primary font-mono">{formatKWh(grandTotal).split(' ')[0]}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{formatKWh(grandTotal).split(' ')[1] || 'kWh'}/Año</p>
                </div>
                <div className="text-center space-y-1">
                  <p className="text-3xl font-black text-primary">{reportClassified.electricity.length}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Eléctricos</p>
                </div>
                <div className="text-center space-y-1 border-l border-outline-variant/10">
                  <p className="text-3xl font-black text-primary">{reportClassified.gas.length}</p>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Gas</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-6 pt-8 text-[10px] font-bold text-placeholder uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Red de Suministros</span>
                <div className="w-1 h-1 rounded-full bg-outline-variant" />
                <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Voltis Intelligent CRM</span>
                <div className="w-1 h-1 rounded-full bg-outline-variant" />
                <span>Emitido: {generatedAt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
              </div>
            </div>
          </div>

          <div className="px-12 py-16 space-y-24">
            
            {/* ════ SECTION 1: Resumen Global ════ */}
            <div className="page-break">
              <SectionTitle num="01" title="Análisis de Consumo Acumulado" subtitle="Distribución globalizada de la demanda energética" />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center pt-8">
                <div className="space-y-8">
                  <div className="p-8 rounded-[2rem] bg-gradient-to-br from-primary/10 to-transparent border border-primary/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                        <BarChart3 className="w-6 h-6 text-primary" />
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Consumo Total</p>
                        <p className="text-3xl font-black text-on-surface tabular-nums">{formatNumber(grandTotal)} <span className="text-sm font-medium">kWh</span></p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/5 text-center">
                      <Zap className="w-4 h-4 text-blue-500 mx-auto mb-2" />
                      <p className="text-xl font-bold text-on-surface tabular-nums">{formatNumber(totalConsumption(reportClassified.electricity))}</p>
                      <p className="text-[9px] text-on-surface-variant font-black uppercase tracking-widest">Electricidad</p>
                    </div>
                    <div className="p-6 rounded-3xl bg-surface-container-low border border-outline-variant/5 text-center">
                      <Flame className="w-4 h-4 text-orange-500 mx-auto mb-2" />
                      <p className="text-xl font-bold text-on-surface tabular-nums">{formatNumber(totalConsumption(reportClassified.gas))}</p>
                      <p className="text-[9px] text-on-surface-variant font-black uppercase tracking-widest">Gas Natural</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center p-8 rounded-[2.5rem] bg-surface-container-low/30 border border-outline-variant/10">
                   <DonutChart 
                    data={['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((l, i) => ({ label: l, value: [totals.p1, totals.p2, totals.p3, totals.p4, totals.p5, totals.p6][i] }))}
                    colors={PERIOD_COLORS}
                    size={220}
                  />
                   <div className="mt-8 flex flex-wrap justify-center gap-3">
                     {PERIOD_COLORS.map((color, i) => (
                       <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/50 border border-outline-variant/10 text-[9px] font-bold text-on-surface-variant uppercase tracking-tighter">
                         <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                         P{i+1}
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            </div>

            {/* ════ SECTION 2: Conclusiones ════ */}
            <div className="page-break space-y-6">
               <SectionTitle num="02" title="Conclusiones y Recomendaciones" />
               <div className="p-8 rounded-[2.5rem] bg-surface-container-low/30 border border-outline-variant/10">
                 {isEditing ? (
                   <textarea
                     value={informeBreve}
                     onChange={(e) => setInformeBreve(e.target.value)}
                     className="w-full h-48 bg-white border border-outline-variant/10 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                     placeholder="Añade aquí el resumen experto..."
                   />
                 ) : (
                   <div className="text-sm text-on-surface-variant whitespace-pre-wrap leading-relaxed min-h-[12rem]">
                     {informeBreve || "No se han añadido conclusiones para este informe."}
                   </div>
                 )}
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
