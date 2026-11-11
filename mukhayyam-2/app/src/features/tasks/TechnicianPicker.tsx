import type { Employee } from '../../types'
import { Chip } from '../../ui/form'
export function TechnicianPicker({
  technicians,
  value,
  onChange,
}: {
  technicians: Employee[]
  value: string[]
  onChange(value: string[]): void
}) {
  return (
    <div className="field">
      <span className="label">
        الفنيون <small className="muted">· بتقدر تختار أكثر من فني</small>
      </span>
      <div className="chips">
        {!technicians.length && <span className="field-hint">لا فنيين بعد.</span>}
        {technicians.map((t) => (
          <Chip
            key={t.id}
            pressed={value.includes(t.id)}
            onClick={() => {
              if (value.includes(t.id)) onChange(value.filter((id) => id !== t.id))
              else if (value.length < 20) onChange([...value, t.id])
            }}
          >
            {t.fullName}
          </Chip>
        ))}
      </div>
      {value.length > 1 && <p className="shared-task-note">مهمة مشتركة · المكتب بيسجّل إنجازها بزر «تم».</p>}
    </div>
  )
}
