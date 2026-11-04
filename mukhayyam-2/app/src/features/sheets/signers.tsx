import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { stamp } from './ui'

/**
 * The two names every printed sheet carries, whoever typed the figures: the site manager (the one with the
 * job title «مدير الموقع») and the office manager (job title «مدير المكتب», else the account with the manager role).
 */
export function useSigners(): { siteManager: string; officeManager: string } {
  return (
    useLiveQuery(async () => {
      const all = (await db.employees.toArray()).filter((e) => e.isActive)
      const byTitle = (re: RegExp) => all.find((e) => e.jobTitle && re.test(e.jobTitle))
      const site = byTitle(/مدير\s*(ال)?موقع/) ?? all.find((e) => e.role === 'generation_operator')
      const office = byTitle(/مدير\s*(ال)?مكتب/) ?? all.find((e) => e.role === 'manager')
      return { siteManager: site?.fullName ?? '', officeManager: office?.fullName ?? '' }
    }, []) ?? { siteManager: '', officeManager: '' }
  )
}

/**
 * The foot of a printed sheet. A sheet that goes through approval shows the time it was sent and approved;
 * the names are always the site manager's and the office manager's, even when someone else filled the sheet in.
 * `approval` is left out for sheets that are only printed: both names then show with a line to sign on.
 */
export function SignFooter({ approval }: { approval?: { submittedAt: string | null; approvedAt: string | null } }) {
  const { siteManager, officeManager } = useSigners()
  return (
    <footer className="ps-foot">
      <div>
        <b>توقيع مدير الموقع</b>
        <span>{siteManager || '—'}{approval?.submittedAt ? ` · ${stamp(approval.submittedAt)}` : ''}</span>
      </div>
      <div>
        <b>اعتماد مدير المكتب</b>
        <span>{!approval || approval.approvedAt ? officeManager || '—' : '—'}{approval?.approvedAt ? ` · ${stamp(approval.approvedAt)}` : ''}</span>
      </div>
    </footer>
  )
}
