'use client'

import { Zap, Flame, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import type { ConsumptionSnapshot } from '@/types/database'
import { classifyRows, totalConsumption, formatKWh } from '@/lib/consumption-utils'

interface Props {
  rows: ConsumptionSnapshot[]
}

export default function ConsumptionStats({ rows }: Props) {
  const classified = classifyRows(rows)
  const total = totalConsumption(rows)
  const okCount = rows.filter(r => r.validation_status === 'OK').length
  const reviewCount = rows.filter(r => r.validation_status === 'Revisar').length
  const incompleteCount = rows.filter(r => r.validation_status === 'Incompleto').length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card className="!p-3">
        <div className="text-xs text-ink-3 mb-1 flex items-center gap-1">
          <Zap className="w-3 h-3" />Suministros
        </div>
        <div className="text-xl font-sans font-bold text-ink">{rows.length}</div>
        <div className="text-[10px] text-ink-3 mt-0.5">
          {classified.electricity.length} elec. · {classified.gas.length} gas
        </div>
      </Card>

      <Card className="!p-3">
        <div className="text-xs text-ink-3 mb-1">Consumo total</div>
        <div className="text-xl font-sans font-bold text-ink">{formatKWh(total)}</div>
        <div className="text-[10px] text-ink-3 mt-0.5">Anual estimado</div>
      </Card>

      <Card className="!p-3">
        <div className="text-xs text-ink-3 mb-1">Tarifas</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {classified.td20.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-info-container/40 text-info">
              2.0TD: {classified.td20.length}
            </span>
          )}
          {classified.td30.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warn-container/40 text-warn">
              3.0TD: {classified.td30.length}
            </span>
          )}
          {classified.td61.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-err-container/40 text-err">
              6.1TD: {classified.td61.length}
            </span>
          )}
          {classified.gas.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-info-container/40 text-info">
              Gas: {classified.gas.length}
            </span>
          )}
        </div>
      </Card>

      <Card className="!p-3">
        <div className="text-xs text-ink-3 mb-1 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-ok" />OK
        </div>
        <div className="text-xl font-sans font-bold text-ok">{okCount}</div>
      </Card>

      <Card className="!p-3">
        <div className="text-xs text-ink-3 mb-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-warn" />Revisar
        </div>
        <div className="text-xl font-sans font-bold text-warn">{reviewCount}</div>
      </Card>

      <Card className="!p-3">
        <div className="text-xs text-ink-3 mb-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 text-err" />Incompleto
        </div>
        <div className="text-xl font-sans font-bold text-err">{incompleteCount}</div>
      </Card>
    </div>
  )
}
