import { Component, type ReactNode } from 'react'
import { captureIssue } from '../lib/clientErrors'
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; reference: string }> {
  state = { failed: false, reference: '' }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    this.setState({ reference: captureIssue('render', error) })
  }
  render() {
    return this.state.failed ? (
      <main className="empty state-view" dir="rtl">
        <h1>صار عطل بالصفحة</h1>
        <p>الشغل المحفوظ على الجهاز باقي. جرّب تفتح الصفحة من جديد.</p>
        {this.state.reference && <p className="num">مرجع العطل: {this.state.reference.slice(0, 8)}</p>}
        <button className="btn primary" onClick={() => window.location.reload()}>
          إعادة فتح الصفحة
        </button>
      </main>
    ) : (
      this.props.children
    )
  }
}
