// The warehouse: items, and every quantity in or out. Balance = all in − all out.

export interface StockItem {
  id: number
  name: string
  unit: string
  minQty: number
  isActive: boolean
  sortOrder: number
}

export type MoveKind = 'in' | 'out'

export interface StockMove {
  id: string
  itemId: number
  kind: MoveKind
  qty: number
  at: string
  note: string
  ref: string
  taskId: string | null
  createdBy: string | null
}

export function balances(moves: StockMove[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const x of moves) m.set(x.itemId, (m.get(x.itemId) ?? 0) + (x.kind === 'in' ? x.qty : -x.qty))
  return m
}

export const isLow = (item: StockItem, balance: number) => item.isActive && balance <= item.minQty
