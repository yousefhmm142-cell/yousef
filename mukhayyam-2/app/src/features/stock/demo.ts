import { db } from '../../data/db'
import { addDays, todayISO } from '../../lib/dates'
import { gazaToIso } from '../attendance/rules'
import type { StockItem, StockMove } from './model'

// Demo mode only: the warehouse items of the site and a few weeks of moves.

const items: StockItem[] = [
  ['طبلون عدادين', 'قطعة', 2],
  ['طبلون 3 عدادات', 'قطعة', 2],
  ['طبلون 4 عدادات', 'قطعة', 2],
  ['عداد كهرباء', 'قطعة', 5],
  ['كابل 4×6', 'متر', 100],
  ['كابل 2×16', 'متر', 100],
  ['قاطع 32A', 'قطعة', 5],
].map(([name, unit, min], i) => ({ id: i + 1, name: name as string, unit: unit as string, minQty: min as number, isActive: true, sortOrder: i + 1 }))

export async function ensureDemoStock(managerId: string): Promise<void> {
  if ((await db.stockItems.count()) === 0) await db.stockItems.bulkPut(items)
  if ((await db.stockMoves.count()) > 0) return
  const today = todayISO()
  const mv = (n: number, itemId: number, kind: 'in' | 'out', qty: number, daysAgo: number, ref: string, note: string, taskId: string | null = null): StockMove => ({
    id: `demo-mv-${n}`, itemId, kind, qty, at: gazaToIso(addDays(today, -daysAgo), '09:30'), note, ref, taskId, createdBy: managerId,
  })
  await db.stockMoves.bulkPut([
    mv(1, 1, 'in', 10, 20, 'فاتورة 4410', 'وارد'),
    mv(2, 4, 'in', 30, 20, 'فاتورة 4410', 'وارد'),
    mv(3, 5, 'in', 500, 18, 'فاتورة 4471', 'وارد'),
    mv(4, 6, 'in', 300, 18, 'فاتورة 4471', 'وارد'),
    mv(5, 7, 'in', 12, 15, 'فاتورة 4502', 'وارد'),
    mv(6, 4, 'out', 26, 6, 'تبديل عدادات تالفة', 'صرف يدوي'),
    mv(7, 5, 'out', 40, 3, '', 'مهمة #1', 'demo-task-1'),
    mv(8, 4, 'out', 1, 0, '', 'مهمة #1', 'demo-task-1'),
  ])
}
