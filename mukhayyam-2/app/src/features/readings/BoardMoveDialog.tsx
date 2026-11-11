import { useState } from 'react'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/primitives'
export function BoardMoveDialog({
  board,
  area,
  areas,
  busy,
  onClose,
  onMove,
}: {
  board: string
  area: string
  areas: string[]
  busy: boolean
  onClose(): void
  onMove(to: string): void
}) {
  const [target, setTarget] = useState(area)
  return (
    <Dialog
      open
      onClose={onClose}
      title={`نقل طبلون ${board}`}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!target.trim() || target.trim() === area || busy}
            onClick={() => onMove(target.trim())}
          >
            نقل الطبلون
          </Button>
        </>
      }
    >
      <label className="field">
        <span>المنطقة الجديدة</span>
        <input
          className="input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          list="move-area-options"
          autoFocus
        />
        <datalist id="move-area-options">
          {areas.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </label>
    </Dialog>
  )
}
