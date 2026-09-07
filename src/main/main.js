'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { app, BaseWindow, WebContentsView, ipcMain, session, shell, clipboard, Menu } = require('electron')
const { TabManager, NEW_TAB_URL } = require('./tabs')
const { installBlocker } = require('./blocker')
const { configureDns } = require('./dns')
const shortcuts = require('./shortcuts')
const bookmarks = require('./bookmarks')

/**
 * Overlay scrollbars: they float over the content, fade out when idle and take
 * no layout width. A permanently parked grey gutter down the right edge is the
 * one piece of chrome this design cannot remove from inside the page, so it is
 * removed from under it instead. Must be set before the app is ready.
 */
app.commandLine.appendSwitch('enable-features', 'FluentOverlayScrollbar,FluentScrollbars,OverlayScrollbar')

/**
 * Electron appends "<appName>/<version> ... Electron/<version>" to the user
 * agent. That leaks the shell to every site, and with this app named
 * "brave-custom" it also made Lobsters serve its block page, because their
 * Brave filter matches the substring. Strip both tokens so we present as the
 * plain Chrome we actually are.
 */
app.userAgentFallback = app.userAgentFallback
  .split(' ' + app.getName() + '/' + app.getVersion())
  .join('')
  .replace(/\s*Electron\/[\d.]+/i, '')

const DEV = process.argv.includes('--dev') || !app.isPackaged
const CHROME_DIR = path.join(__dirname, '../chrome')
const PRELOAD = path.join(__dirname, '../preload/chrome.js')

/**
 * There is no frame, no title bar, no menu and no drag region. The page is
 * full-bleed across the whole window, and the only chrome is one small view:
 *
 *   dock  the floating pill at the bottom. Collapsed it is barely bigger than
 *         the pill, so it swallows as few clicks as possible; it grows upward
 *         on hover to show the key legend, and expands to the whole window when
 *         the command palette opens.
 *
 * Everything else is a key -- including moving the window, which has no handle
 * to drag any more. See shortcuts.js for the whole table.
 */
const DOCK = { w: 600, collapsed: 86, expanded: 124, bottom: 14 }

let win = null
let dockView = null
let tabs = null
let dns = null

let overlay = false // palette open: the dock covers the window
let hovered = false // pointer inside the dock: legend visible

/** Recently visited pages, newest first. Feeds the palette. */
const history = []
const HISTORY_MAX = 300

// -- window -------------------------------------------------------------------

function createWindow() {
  win = new BaseWindow({
    width: 1320,
    height: 860,
    minWidth: 620,
    minHeight: 420,
    frame: false,
    backgroundColor: '#0b0b0e',
    show: false,
  })

  dockView = new WebContentsView({
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  })
  // Transparent so the page shows through everywhere the dock paints nothing.
  dockView.setBackgroundColor('#00000000')
  win.contentView.addChildView(dockView)
  dockView.webContents.loadFile(path.join(CHROME_DIR, 'dock.html'))
  bindShortcuts(dockView.webContents)

  dockView.webContents.on('did-finish-load', () => {
    dockView.webContents.send('window:state', windowState())
    dockView.webContents.send('keys:legend', shortcuts.legend())
    dockView.webContents.send('history:state', history)
    dockView.webContents.send('bookmarks:state', bookmarks.list())
    if (tabs) dockView.webContents.send('tabs:state', tabs.snapshot())
  })

  tabs = new TabManager({
    win,
    onChange: (state) => send('tabs:state', state),
    onNavigated: recordHistory,
    onWebContents: bindShortcuts,
    raiseChrome,
  })

  win.on('resize', applyLayout)
  win.on('maximize', broadcastWindow)
  win.on('unmaximize', broadcastWindow)
  win.on('closed', () => {
    win = null
  })

  applyLayout()
  win.show()
  tabs.create()
}

/** Keys are matched here, on every web contents, because there is no menu. */
function bindShortcuts(wc) {
  wc.on('before-input-event', (event, input) => {
    if (shortcuts.handle(input, ctx())) event.preventDefault()
  })
  wc.on('did-finish-load', () => {
    if (wc.getURL() === NEW_TAB_URL) pushBookmarksTo(wc)
  })
}

function ctx() {
  return {
    win,
    tabs,
    openPalette,
    quit: () => app.quit(),
    toggleBookmark,
    reloadChromeUi,
    dockDevTools: () => dockView.webContents.toggleDevTools({ mode: 'detach' }),
  }
}

function send(channel, payload) {
  if (dockView && !dockView.webContents.isDestroyed()) dockView.webContents.send(channel, payload)
}

function windowState() {
  return { maximized: win ? win.isMaximized() : false, platform: process.platform, dns }
}

function broadcastWindow() {
  applyLayout()
  send('window:state', windowState())
}

/** The dock stays above the page views so it can paint over the page. */
function raiseChrome() {
  if (win && dockView) win.contentView.addChildView(dockView)
}

function applyLayout() {
  if (!win || !tabs) return
  const { width, height } = win.getContentBounds()

  if (overlay) {
    dockView.setBounds({ x: 0, y: 0, width, height })
  } else {
    const w = Math.min(DOCK.w, width - 48)
    const h = hovered ? DOCK.expanded : DOCK.collapsed
    dockView.setBounds({
      x: Math.round((width - w) / 2),
      y: Math.max(0, height - h - DOCK.bottom),
      width: w,
      height: h,
    })
  }

  // Truly full-bleed: nothing displaces the page.
  tabs.setPageBounds({ x: 0, y: 0, width, height })
}

// -- bookmarks ----------------------------------------------------------------

/** Bookmarks the active tab, or un-bookmarks it if it already is one. */
function toggleBookmark() {
  const tab = tabs && tabs.active()
  if (!tab || tab.url === NEW_TAB_URL) return
  bookmarks.toggle(tab.url, tab.title)
  send('bookmarks:state', bookmarks.list())
  refreshNewTabPages()
}

/**
 * The new tab page runs with no preload -- every tab shares one webPreferences,
 * and handing a bookmarks API to every website would be reckless. So the list is
 * pushed in one-way instead, by calling a function the page defines.
 */
function pushBookmarksTo(wc) {
  if (wc.isDestroyed()) return
  wc.executeJavaScript(
    'window.renderBookmarks && window.renderBookmarks(' + JSON.stringify(bookmarks.list()) + ')',
  ).catch(() => {})
}

function refreshNewTabPages() {
  if (!tabs) return
  for (const t of tabs.tabs.values()) {
    if (t.url === NEW_TAB_URL) pushBookmarksTo(t.view.webContents)
  }
}

// -- history ------------------------------------------------------------------

function recordHistory({ url, title }) {
  if (!url || url === NEW_TAB_URL || url.startsWith('about:')) return
  const at = history.findIndex((h) => h.url === url)
  if (at !== -1) history.splice(at, 1)
  history.unshift({ url, title: title || url, ts: Date.now() })
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX
  send('history:state', history)
}

// -- palette ------------------------------------------------------------------

/**
 * Opening the palette has to take OS focus for the dock view, or keystrokes
 * would keep going to the page underneath.
 */
function openPalette(mode = 'all') {
  if (!dockView || dockView.webContents.isDestroyed()) return
  overlay = true
  hovered = false
  raiseChrome()
  applyLayout()
  dockView.webContents.focus()
  dockView.webContents.send('palette:open', { mode })
}

function closePalette() {
  if (!overlay) return
  overlay = false
  applyLayout()
  if (dockView && !dockView.webContents.isDestroyed()) dockView.webContents.send('palette:close')
  tabs.focusPage()
}

// -- IPC ----------------------------------------------------------------------

function registerIpc() {
  ipcMain.on('tab:new', (_e, url) => tabs.create(url || NEW_TAB_URL))
  ipcMain.on('tab:close', (_e, id) => tabs.close(id ?? tabs.activeId))
  ipcMain.on('tab:activate', (_e, id) => tabs.activate(id))
  ipcMain.on('tab:navigate', (_e, p) => tabs.navigate(p.id ?? tabs.activeId, p.input))
  ipcMain.on('tab:back', (_e, id) => tabs.goBack(id ?? tabs.activeId))
  ipcMain.on('tab:forward', (_e, id) => tabs.goForward(id ?? tabs.activeId))
  ipcMain.on('tab:reload', (_e, p) => tabs.reload((p && p.id) ?? tabs.activeId, p && p.hard))
  ipcMain.on('tab:stop', (_e, id) => tabs.stop(id ?? tabs.activeId))
  ipcMain.on('page:focus', () => tabs.focusPage())

  // The dock reports pointer enter/leave so main can grow the view enough for
  // the legend -- CSS alone cannot, the view itself would clip it.
  ipcMain.on('dock:hover', (_e, on) => {
    if (overlay) return
    hovered = !!on
    applyLayout()
  })

  ipcMain.on('bookmark:toggle', toggleBookmark)
  ipcMain.on('bookmark:remove', (_e, url) => {
    bookmarks.remove(url)
    send('bookmarks:state', bookmarks.list())
    refreshNewTabPages()
  })

  ipcMain.on('palette:open', (_e, mode) => openPalette(mode))
  ipcMain.on('palette:close', closePalette)

  ipcMain.on('window:minimize', () => win && win.minimize())
  ipcMain.on('window:maximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', () => win && win.close())
  ipcMain.on('shell:open-external', (_e, url) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
  })
  ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text || '')))
  ipcMain.on('devtools:page', () => tabs.toggleDevTools())

  ipcMain.handle('chrome:info', () => ({ window: windowState(), keys: shortcuts.legend(), dev: DEV }))
}

// -- chrome UI hot reload -----------------------------------------------------

function reloadChromeUi() {
  if (dockView && !dockView.webContents.isDestroyed()) dockView.webContents.reload()
}

/** Edit anything in src/chrome/ and the dock repaints. */
function watchChromeUi() {
  let timer = null
  try {
    fs.watch(CHROME_DIR, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(reloadChromeUi, 80)
    })
  } catch (err) {
    console.warn('chrome UI watch unavailable:', err.message)
  }
}

// -- boot ---------------------------------------------------------------------

app.whenReady().then(() => {
  // No menu at all. Standard editing keys still work -- Chromium handles those
  // natively inside editable fields, they were never coming from the menu.
  Menu.setApplicationMenu(null)

  bookmarks.load()
  dns = configureDns(app)
  console.log(`DNS: ${dns.label} (${dns.note})${dns.secure ? ' over HTTPS' : ''}`)

  installBlocker(session.defaultSession, (webContentsId) => {
    if (tabs) tabs.noteBlocked(webContentsId)
  })
  registerIpc()
  createWindow()
  if (DEV) watchChromeUi()

  app.on('activate', () => {
    if (!win) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
