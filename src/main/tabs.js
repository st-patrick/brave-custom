'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { WebContentsView, shell } = require('electron')

// pathToFileURL so this matches what webContents.getURL() reports back to us.
const NEW_TAB_URL = pathToFileURL(path.join(__dirname, '../chrome/newtab.html')).href

/**
 * Owns one WebContentsView per tab, keeps their bounds in sync with the page
 * rect the chrome UI asks for, and pushes a plain-JSON snapshot of tab state to
 * the chrome UI whenever anything changes.
 */
class TabManager {
  constructor({ win, onChange, onNavigated, onWebContents, raiseChrome }) {
    this.win = win
    this.onChange = onChange
    this.onNavigated = onNavigated || (() => {})
    // Every page gets the key bindings attached: there is no menu to catch them.
    this.onWebContents = onWebContents || (() => {})
    this.raiseChrome = raiseChrome || (() => {})
    this.tabs = new Map() // id -> { id, view, title, url, favicon, loading, canGoBack, canGoForward, blocked }
    this.order = []
    this.activeId = null
    this.pageBounds = { x: 0, y: 0, width: 0, height: 0 }
    this.nextId = 1
  }

  // ---- state ----------------------------------------------------------------

  snapshot() {
    return {
      activeId: this.activeId,
      tabs: this.order.map((id) => {
        const t = this.tabs.get(id)
        return {
          id: t.id,
          title: t.title,
          url: t.url,
          favicon: t.favicon,
          loading: t.loading,
          canGoBack: t.canGoBack,
          canGoForward: t.canGoForward,
          blocked: t.blocked,
          isNewTab: t.url === NEW_TAB_URL,
        }
      }),
    }
  }

  emit() {
    this.onChange(this.snapshot())
  }

  tabByWebContentsId(id) {
    for (const t of this.tabs.values()) {
      if (!t.view.webContents.isDestroyed() && t.view.webContents.id === id) return t
    }
    return null
  }

  noteBlocked(webContentsId) {
    const tab = this.tabByWebContentsId(webContentsId)
    if (!tab) return
    tab.blocked += 1
    // Blocked requests arrive in bursts; coalesce the UI updates.
    if (!this._blockedFlush) {
      this._blockedFlush = setTimeout(() => {
        this._blockedFlush = null
        this.emit()
      }, 250)
    }
  }

  // ---- lifecycle ------------------------------------------------------------

  create(url = NEW_TAB_URL, { activate = true } = {}) {
    const id = this.nextId++
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    })
    view.setBackgroundColor('#ffffff')

    const tab = {
      id,
      view,
      title: 'New tab',
      url,
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      blocked: 0,
    }
    this.tabs.set(id, tab)
    this.order.push(id)
    this._wire(tab)

    this.win.contentView.addChildView(view)
    this.raiseChrome() // keep the chrome UI above every page view
    view.setVisible(false)
    view.setBounds(this.pageBounds)
    view.webContents.loadURL(url)

    if (activate) this.activate(id)
    else this.emit()
    return id
  }

  _wire(tab) {
    const wc = tab.view.webContents
    this.onWebContents(wc)
    const sync = () => {
      if (wc.isDestroyed()) return
      tab.url = wc.getURL() || tab.url
      // page-title-updated does not fire reliably on a WebContentsView, so the
      // title is pulled rather than pushed. The event below is kept because
      // when it does fire it is faster than waiting for the load to settle.
      const title = wc.getTitle()
      if (title) tab.title = title
      tab.canGoBack = wc.navigationHistory.canGoBack()
      tab.canGoForward = wc.navigationHistory.canGoForward()
      this.onNavigated({ url: tab.url, title: tab.title })
      this.emit()
    }

    wc.on('page-title-updated', (_e, title) => {
      tab.title = title
      this.onNavigated({ url: tab.url, title })
      this.emit()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] || null
      this.emit()
    })
    wc.on('did-start-loading', () => {
      tab.loading = true
      this.emit()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
      sync()
    })
    wc.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) {
        tab.blocked = 0
        tab.favicon = null
      }
    })
    wc.on('did-navigate', sync)
    wc.on('did-navigate-in-page', sync)
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3 is a user-cancelled load
      tab.title = 'Cannot reach this page'
      tab.url = failedUrl
      tab.loading = false
      this.emit()
    })

    // target=_blank and window.open become tabs, not popup windows.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'save-to-disk') return { action: 'allow' }
      if (/^https?:/.test(url)) this.create(url, { activate: disposition !== 'background-tab' })
      else if (/^mailto:|^tel:/.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })

    // Hand non-web schemes to the OS rather than trying to render them.
    wc.on('will-navigate', (event, url) => {
      if (!/^(https?|file|about|data):/.test(url)) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })
  }

  close(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const i = this.order.indexOf(id)
    this.order.splice(i, 1)
    this.tabs.delete(id)

    try {
      this.win.contentView.removeChildView(tab.view)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    } catch {
      /* already gone */
    }

    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[Math.min(i, this.order.length - 1)]
      if (next != null) this.activate(next)
      else this.create()
    } else {
      this.emit()
    }
  }

  activate(id) {
    if (!this.tabs.has(id)) return
    this.activeId = id
    for (const t of this.tabs.values()) t.view.setVisible(t.id === id)
    const tab = this.tabs.get(id)
    tab.view.setBounds(this.pageBounds)
    this.emit()
  }

  active() {
    return this.activeId == null ? null : this.tabs.get(this.activeId)
  }

  /** Moves the selection `step` places, wrapping at both ends. */
  cycle(step) {
    if (this.order.length < 2) return
    const at = this.order.indexOf(this.activeId)
    const next = (at + step + this.order.length) % this.order.length
    this.activate(this.order[next])
  }

  // ---- actions --------------------------------------------------------------

  navigate(id, input) {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.view.webContents.loadURL(toUrl(input))
  }

  goBack(id) {
    const t = this.tabs.get(id)
    if (t && t.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack()
  }

  goForward(id) {
    const t = this.tabs.get(id)
    if (t && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward()
  }

  reload(id, hard = false) {
    const t = this.tabs.get(id)
    if (!t) return
    hard ? t.view.webContents.reloadIgnoringCache() : t.view.webContents.reload()
  }

  stop(id) {
    const t = this.tabs.get(id)
    if (t) t.view.webContents.stop()
  }

  focusPage() {
    const t = this.active()
    if (t) t.view.webContents.focus()
  }

  toggleDevTools() {
    const t = this.active()
    if (t) t.view.webContents.toggleDevTools()
  }

  // ---- layout ---------------------------------------------------------------

  setPageBounds(bounds) {
    this.pageBounds = bounds
    const t = this.active()
    if (t) t.view.setBounds(bounds)
  }
}

/** Turns whatever was typed in the address bar into a URL. */
function toUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return NEW_TAB_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(about|data|file|mailto):/i.test(raw)) return raw
  // Looks like a bare host or an IP, and has no spaces -> treat it as a URL.
  const looksLikeHost = /^[^\s/]+\.[^\s/]{2,}(\/|$|\?|#)/.test(raw) || /^localhost(:\d+)?(\/|$)/.test(raw)
  if (looksLikeHost) return 'https://' + raw
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(raw)
}

module.exports = { TabManager, NEW_TAB_URL, toUrl }
