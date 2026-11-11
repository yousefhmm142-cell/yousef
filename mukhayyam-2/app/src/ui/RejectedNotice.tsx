import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useLocation } from 'react-router'
import { TriangleAlert } from 'lucide-react'
import { useEmployee } from '../auth/AuthProvider'
import { rejectedWrites } from '../data/rejected'
export function RejectedNotice() {
  const me = useEmployee(),
    { pathname } = useLocation()
  const count = useLiveQuery(async () => (await rejectedWrites(me.id)).length, [me.id])
  if (!count || pathname === '/account') return null
  return (
    <Link to="/account" className="sync-notice warn rejected-notice" role="status">
      <TriangleAlert size={18} aria-hidden="true" />
      <span>في {count} عمليات بدها مراجعة. تفاصيلها محفوظة في حسابي.</span>
    </Link>
  )
}
