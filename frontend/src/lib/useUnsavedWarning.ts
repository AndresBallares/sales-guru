import { useEffect } from 'react'

export const UNSAVED_MESSAGE =
  'You have unsaved changes on this page. If you leave now they will be lost. Leave anyway?'

// While `dirty`, the browser asks before a refresh, a close or a typed address, and a
// click on a link that leaves this page asks first (window.confirm). A link to another
// place on the same page (a #tab) is not a way out, so it is left alone.
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    function onClick(event: MouseEvent) {
      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target === '_blank') return
      const url = new URL(anchor.href, window.location.href)
      const here = window.location
      if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search) {
        return
      }
      if (!window.confirm(UNSAVED_MESSAGE)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])
}
