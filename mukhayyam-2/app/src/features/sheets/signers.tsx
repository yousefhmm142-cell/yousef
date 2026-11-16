import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { stamp } from './ui'

export const OFFICE_MANAGER_NAME = 'رامي أبو عجوة'

/**
 * The names used on printed sheets, whoever typed the figures: the site manager (the one with the
 * job title «مدير الموقع») and the office manager (fixed by the office owner, independent of the signed-in account).
 */
export function useSigners(): { siteManager: string; officeManager: string } {
  return (
    useLiveQuery(async () => {
      const all = (await db.employees.toArray()).filter((e) => e.isActive)
      const byTitle = (re: RegExp) => all.find((e) => e.jobTitle && re.test(e.jobTitle))
      const site = byTitle(/مدير\s*(ال)?موقع/) ?? all.find((e) => e.role === 'generation_operator')
      return { siteManager: site?.fullName ?? '', officeManager: OFFICE_MANAGER_NAME }
    }, []) ?? { siteManager: '', officeManager: OFFICE_MANAGER_NAME }
  )
}

/**
 * The foot of a printed sheet. A sheet that goes through approval shows the time it was sent and approved;
 * generation and distribution carry the site manager's signature and the office manager's approval.
 * `approval` is left out for other sheets: only the office manager then shows with a line to sign on.
 */
export function SignFooter({ approval }: { approval?: { submittedAt: string | null; approvedAt: string | null } }) {
  const { siteManager, officeManager } = useSigners()
  return (
    <footer className="ps-foot">
      {approval && (
        <div>
          <b>توقيع مدير الموقع</b>
          <span>{siteManager || '—'}{approval.submittedAt ? ` · ${stamp(approval.submittedAt)}` : ''}</span>
        </div>
      )}
      <div>
        <b>اعتماد مدير المكتب</b>
        <span>{officeManager}{approval?.approvedAt ? ` · ${stamp(approval.approvedAt)}` : ''}</span>
      </div>
    </footer>
  )
}
