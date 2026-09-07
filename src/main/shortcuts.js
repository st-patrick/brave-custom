'use strict'

/**
 * Every binding in the browser, in one table.
 *
 * There is no application menu -- keys are matched off `before-input-event` on
 * each web contents instead. That means no menu bar exists to be shown or
 * hidden, and no accelerator can be registered system-wide by accident.
 *
 * The same table is sent to the chrome UI to render the shortcuts sheet, so the
 * printed legend cannot drift from what the keys actually do.
 *
 * "Mod" is Cmd on macOS and Ctrl everywhere else.
 */

const MOVE_STEP = 48
const RESIZE_STEP = 48

const BINDINGS = [
  // -- navigate ---------------------------------------------------------------
  { group: 'Navigate', keys: 'Mod+K', label: 'Command palette — tabs, history, actions', short: 'command', run: (c) => c.openPalette('all') },
  { group: 'Navigate', keys: 'Mod+L', label: 'Address — type a URL or a search', short: 'address', run: (c) => c.openPalette('url') },
  { group: 'Navigate', keys: 'Mod+/', label: 'This sheet', short: 'all keys', run: (c) => c.openPalette('keys') },
  { group: 'Navigate', keys: 'Alt+Left', label: 'Back', run: (c) => c.tabs.goBack(c.tabs.activeId) },
  { group: 'Navigate', keys: 'Alt+Right', label: 'Forward', run: (c) => c.tabs.goForward(c.tabs.activeId) },
  { group: 'Navigate', keys: 'Mod+R', label: 'Reload', run: (c) => c.tabs.reload(c.tabs.activeId) },
  { group: 'Navigate', keys: 'Mod+Shift+R', label: 'Reload, ignoring cache', run: (c) => c.tabs.reload(c.tabs.activeId, true) },

  // -- tabs -------------------------------------------------------------------
  { group: 'Tabs', keys: 'Mod+T', label: 'New tab', short: 'new tab', run: (c) => c.tabs.create() },
  { group: 'Tabs', keys: 'Mod+W', label: 'Close tab', run: (c) => c.tabs.close(c.tabs.activeId) },
  { group: 'Tabs', keys: 'Mod+Tab', label: 'Next tab', run: (c) => c.tabs.cycle(1) },
  { group: 'Tabs', keys: 'Mod+Shift+Tab', label: 'Previous tab', run: (c) => c.tabs.cycle(-1) },
  { group: 'Tabs', keys: 'Mod+1…9', label: 'Jump to tab by position', short: 'jump', match: digitMatch, run: (c, input) => {
    const id = c.tabs.order[Number(input.key) - 1]
    if (id != null) c.tabs.activate(id)
  } },

  // -- bookmarks --------------------------------------------------------------
  { group: 'Bookmarks', keys: 'Mod+D', label: 'Bookmark this page, or remove it', short: 'bookmark', run: (c) => c.toggleBookmark() },

  // -- window -----------------------------------------------------------------
  // There is no title bar and no drag region, so the window is moved by key.
  { group: 'Window', keys: 'Mod+Alt+Left', label: 'Move window left', run: (c) => move(c, -MOVE_STEP, 0) },
  { group: 'Window', keys: 'Mod+Alt+Right', label: 'Move window right', run: (c) => move(c, MOVE_STEP, 0) },
  { group: 'Window', keys: 'Mod+Alt+Up', label: 'Move window up', run: (c) => move(c, 0, -MOVE_STEP) },
  { group: 'Window', keys: 'Mod+Alt+Down', label: 'Move window down', run: (c) => move(c, 0, MOVE_STEP) },
  { group: 'Window', keys: 'Mod+Alt+Shift+Left', label: 'Narrower', run: (c) => resize(c, -RESIZE_STEP, 0) },
  { group: 'Window', keys: 'Mod+Alt+Shift+Right', label: 'Wider', run: (c) => resize(c, RESIZE_STEP, 0) },
  { group: 'Window', keys: 'Mod+Alt+Shift+Up', label: 'Shorter', run: (c) => resize(c, 0, -RESIZE_STEP) },
  { group: 'Window', keys: 'Mod+Alt+Shift+Down', label: 'Taller', run: (c) => resize(c, 0, RESIZE_STEP) },
  { group: 'Window', keys: 'Mod+Alt+Enter', label: 'Maximize / restore', run: (c) => {
    if (c.win.isMaximized()) c.win.unmaximize()
    else c.win.maximize()
  } },
  { group: 'Window', keys: 'Mod+Alt+C', label: 'Centre on screen', run: (c) => c.win.center() },
  { group: 'Window', keys: 'Mod+Alt+H', label: 'Minimize', run: (c) => c.win.minimize() },
  { group: 'Window', keys: 'Mod+Alt+F', label: 'Fullscreen', run: (c) => c.win.setFullScreen(!c.win.isFullScreen()) },
  { group: 'Window', keys: 'Mod+Shift+Q', label: 'Quit', run: (c) => c.quit() },

  // -- chrome -----------------------------------------------------------------
  { group: 'Chrome', keys: 'F12', label: 'DevTools for the page', run: (c) => c.tabs.toggleDevTools() },
  { group: 'Chrome', keys: 'Mod+Shift+I', label: 'DevTools for this UI', run: (c) => c.dockDevTools() },
  { group: 'Chrome', keys: 'Mod+Shift+U', label: 'Reload this UI from disk', run: (c) => c.reloadChromeUi() },
]

function move(c, dx, dy) {
  const b = c.win.getBounds()
  c.win.setBounds({ ...b, x: b.x + dx, y: b.y + dy })
}

function resize(c, dw, dh) {
  const b = c.win.getBounds()
  c.win.setBounds({ ...b, width: Math.max(620, b.width + dw), height: Math.max(420, b.height + dh) })
}

/** Mod+1 … Mod+9, matched as a range rather than nine separate rows. */
function digitMatch(input, mac) {
  return (
    mod(input, mac) && !input.alt && !input.shift && /^[1-9]$/.test(input.key)
  )
}

function mod(input, mac) {
  return mac ? input.meta && !input.control : input.control && !input.meta
}

const KEY_ALIASES = {
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  enter: 'enter',
  tab: 'tab',
  esc: 'escape',
}

const NAMED = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'enter', 'tab', 'escape'])

/** "Mod+Alt+Shift+Left" -> a predicate over an Electron input event. */
function parse(keys) {
  const parts = keys.toLowerCase().split('+')
  const want = {
    mod: parts.includes('mod'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
  }
  const bare = parts[parts.length - 1]
  want.key = KEY_ALIASES[bare] || bare

  // Punctuation sits on different physical keys per layout -- "/" is Shift+7 on
  // a German keyboard, unshifted on a US one. Matching Shift exactly would make
  // those bindings dead on half of Europe, so for symbols Shift is not checked
  // unless the binding asked for it.
  const symbol = !NAMED.has(want.key) && !/^[a-z0-9]$/.test(want.key) && !/^f\d+$/.test(want.key)
  want.anyShift = symbol && !want.shift
  return want
}

function matches(want, input, mac) {
  if (want.mod !== mod(input, mac)) return false
  if (want.alt !== !!input.alt) return false
  if (!want.anyShift && want.shift !== !!input.shift) return false
  return String(input.key || '').toLowerCase() === want.key
}

const COMPILED = BINDINGS.map((b) => ({ ...b, want: b.match ? null : parse(b.keys) }))

/**
 * Runs the binding for `input`, if any. Returns true when the key was consumed
 * and the caller should preventDefault.
 */
function handle(input, ctx) {
  if (input.type !== 'keyDown') return false
  const mac = process.platform === 'darwin'
  for (const b of COMPILED) {
    const hit = b.match ? b.match(input, mac) : matches(b.want, input, mac)
    if (!hit) continue
    try {
      b.run(ctx, input)
    } catch (err) {
      console.warn('shortcut ' + b.keys + ' failed:', err.message)
    }
    return true
  }
  return false
}

/** The same table, as plain data, for the shortcuts sheet. */
function legend() {
  const mac = process.platform === 'darwin'
  const label = (k) =>
    k
      .replace(/Mod/g, mac ? '⌘' : 'Ctrl')
      .replace(/Alt/g, mac ? '⌥' : 'Alt')
      .replace(/Shift/g, mac ? '⇧' : 'Shift')
  const groups = []
  for (const b of BINDINGS) {
    let g = groups.find((x) => x.group === b.group)
    if (!g) groups.push((g = { group: b.group, rows: [] }))
    g.rows.push({ keys: label(b.keys), label: b.label, short: b.short, raw: b.keys })
  }
  return groups
}

module.exports = { handle, legend }
