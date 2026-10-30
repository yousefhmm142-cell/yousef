import { Check } from 'lucide-react'
import { modules, TOTAL_STEPS, type ModuleKey } from '../app/modules'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { Pill } from '../ui/primitives'

/** Placeholder for a screen that a later build step delivers; says what it will hold. */
export function ModuleSoon({ module }: { module: ModuleKey }) {
  const info = modules[module]
  const Icon = info.icon
  useDocumentTitle(info.title)

  return (
    <section className="soon">
      <div className="soon-hero glass">
        <span className="soon-icon" aria-hidden="true">
          <Icon size={30} />
        </span>
        <div className="soon-text">
          <Pill tone="brand">
            يُبنى في الخطوة {info.step} من {TOTAL_STEPS}
          </Pill>
          <h1>{info.title}</h1>
          <p>{info.summary}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h2>ما ستجده هنا</h2>
        </div>
        <ul className="soon-list">
          {info.features.map((f) => (
            <li key={f}>
              <span className="soon-check" aria-hidden="true">
                <Check size={15} strokeWidth={2.6} />
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
