import { useSearchParams } from 'react-router'
import { DistributionHistoryPage } from '../distribution/HistoryPage'
import { HistoryPage } from '../generation/HistoryPage'
import { Segmented } from '../../ui/form'

const kinds = [
  { value: 'generation', label: 'تقارير التوليد' },
  { value: 'distribution', label: 'كشوف التوزيع' },
] as const
type Kind = (typeof kinds)[number]['value']

/** The site's earlier reports and sheets, one switch between them. */
export function SiteHistoryPage() {
  const [params, setParams] = useSearchParams()
  const kind: Kind = params.get('kind') === 'distribution' ? 'distribution' : 'generation'
  return (
    <div className="site-history">
      <div className="site-history-switch">
        <Segmented<Kind>
          label="نوع الكشف"
          value={kind}
          options={kinds}
          onChange={(k) => setParams(k === 'generation' ? {} : { kind: k }, { replace: true })}
        />
      </div>
      {kind === 'generation' ? <HistoryPage /> : <DistributionHistoryPage />}
    </div>
  )
}
