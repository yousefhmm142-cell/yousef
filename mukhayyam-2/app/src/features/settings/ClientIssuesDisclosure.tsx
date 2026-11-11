import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ClientIssues } from './ClientIssues'
export function ClientIssuesDisclosure() {
  const [open,setOpen]=useState(false)
  return <details className="card client-issues-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>أعطال النظام<ChevronDown size={18} aria-hidden="true" /></summary>{open && <ClientIssues />}</details>
}
