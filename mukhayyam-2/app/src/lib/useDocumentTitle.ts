import { useEffect } from 'react'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · مخيم 2`
  }, [title])
}
