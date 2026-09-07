'use strict'

/**
 * The dock: the floating pill, and the command palette it turns into.
 *
 * Everything the browser can do that is not a keystroke happens here. The pill
 * shows state; the palette is the only navigation surface, so it has to cover
 * tabs, history, actions and raw URL entry in one list.
 */

const $ = (id) => document.getElementById(id)

/**
 * The accelerators are registered as CmdOrCtrl, so the labels have to follow
 * the platform too -- a Windows build showing "⌘T" is simply lying.
 */
const MAC = navigator.userAgent.includes('Mac')
const keyLabel = (s) =>
  MAC ? s : String(s).replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+')

/** Rewrites the key glyphs baked into the palette footer, once, on load. */
function localizeKeys() {
  if (MAC) return
  for (const el of document.querySelectorAll('.foot b')) {
    el.textContent = keyLabel(el.textContent)
  }
}

/**
 * The bindings, straight from src/main/shortcuts.js. Both the hover legend and
 * the shortcuts sheet are drawn from this, so neither can describe a key that
 * does not exist.
 */
let legend = []

/** A few headline bindings, picked by their canonical name, for the pill. */
const MINI = ['Mod+K', 'Mod+L', 'Mod+T', 'Mod+1…9', 'Mod+/']

function renderLegend() {
  const rows = legend.flatMap((g) => g.rows)
  const el = $('legend')
  el.innerHTML = ''
  for (const raw of MINI) {
    const row = rows.find((r) => r.raw === raw)
    if (!row) continue
    const span = document.createElement('span')
    const k = document.createElement('kbd')
    k.textContent = row.keys
    // The sheet carries the full sentence; the pill gets the short verb.
    span.append(k, ' ' + (row.short || row.label.toLowerCase()))
    el.appendChild(span)
  }
}

function renderSheet() {
  const sheet = $('keysheet')
  sheet.innerHTML = ''
  const table = document.createElement('table')
  for (const g of legend) {
    const head = table.insertRow()
    head.className = 'grp'
    const hc = head.insertCell()
    hc.colSpan = 2
    hc.textContent = g.group
    for (const r of g.rows) {
      const tr = table.insertRow()
      const kc = tr.insertCell()
      for (const part of r.keys.split(' ')) {
        const k = document.createElement('kbd')
        k.textContent = part
        kc.append(k, ' ')
      }
      tr.insertCell().textContent = r.label
    }
  }
  sheet.appendChild(table)
}

let state = { tabs: [], activeId: null }
let history = []
let marks = []
let mode = 'all'
let rows = [] // the flattened, filtered result list
let cursor = 0

// -- pill ---------------------------------------------------------------------

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null
}

function renderPill() {
  const tab = activeTab()
  $('count').textContent = String(state.tabs.length)

  const blocked = tab ? tab.blocked : 0
  $('blocked').textContent = blocked ? String(blocked) : ''
  $('shield').classList.toggle('blocking', blocked > 0)
  $('shield').title = blocked
    ? blocked + ' trackers and ads blocked on this page'
    : 'No trackers blocked here yet'

  const addr = $('addr')
  if (!tab || tab.isNewTab) {
    addr.innerHTML = '<span class="placeholder">Search, or type a URL</span>'
    return
  }
  let url
  try {
    url = new URL(tab.url)
  } catch {
    addr.textContent = tab.url
    return
  }
  const path = (url.pathname === '/' ? '' : url.pathname) + url.search
  addr.innerHTML = ''
  const host = document.createElement('span')
  host.className = 'host'
  host.textContent = url.hostname.replace(/^www\./, '')
  const rest = document.createElement('span')
  rest.className = 'path'
  rest.textContent = path
  addr.append(host, rest)
}

// The view rect is owned by main, so hover has to round-trip: CSS cannot make
// the legend visible outside the view's own bounds.
let leaveTimer = null
document.body.addEventListener('mouseenter', () => {
  clearTimeout(leaveTimer)
  document.body.classList.add('hover')
  browser.setDockHover(true)
})
document.body.addEventListener('mouseleave', () => {
  clearTimeout(leaveTimer)
  leaveTimer = setTimeout(() => {
    document.body.classList.remove('hover')
    browser.setDockHover(false)
  }, 120)
})

$('pill').addEventListener('click', () => browser.openPalette('url'))

// -- palette ------------------------------------------------------------------

const ACTIONS = [
  { label: 'New tab', key: keyLabel('⌘T'), run: () => browser.newTab() },
  { label: 'BOOKMARK', key: keyLabel('⌘D'), run: () => browser.toggleBookmark() },
  { label: 'Close this tab', key: keyLabel('⌘W'), run: () => browser.closeTab() },
  { label: 'Reload', key: keyLabel('⌘R'), run: () => browser.reload() },
  { label: 'Copy page address', key: '', run: () => {
    const t = activeTab()
    if (t && !t.isNewTab) browser.copy(t.url)
  } },
  { label: 'Show all shortcuts', key: keyLabel('⌘/'), run: () => setMode('keys'), keepOpen: true },
  { label: 'DevTools for this page', key: 'F12', run: () => browser.pageDevTools() },
]

const looksLikeUrl = (s) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ||
  /^[^\s/]+\.[^\s/]{2,}(\/|$|\?|#)/.test(s) ||
  /^localhost(:\d+)?(\/|$)/.test(s)

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + ' min ago'
  const h = Math.round(m / 60)
  if (h < 24) return h + 'h ago'
  return Math.round(h / 24) + 'd ago'
}

/** Builds the flat row list for the current query. */
function build(q) {
  const needle = q.trim().toLowerCase()
  const out = []

  // A raw URL or a search always gets the top row, so Enter is never ambiguous.
  if (needle) {
    const isUrl = looksLikeUrl(q.trim())
    out.push({
      sect: isUrl ? 'Open' : 'Search',
      title: isUrl ? q.trim() : 'Search DuckDuckGo for “' + q.trim() + '”',
      hint: isUrl ? 'go to this address' : '',
      accent: true,
      key: '↵',
      run: (newTab) => (newTab ? browser.newTab(q.trim()) : browser.navigate(q.trim())),
    })
  }

  const match = (s) => !needle || String(s || '').toLowerCase().includes(needle)

  for (const t of state.tabs) {
    if (t.id === state.activeId && !needle) continue
    const label = t.isNewTab ? 'New tab' : t.title || hostOf(t.url)
    if (!match(label) && !match(t.url)) continue
    out.push({
      sect: 'Open tabs',
      title: label,
      hint: t.isNewTab ? '' : shortUrl(t.url),
      favicon: t.favicon,
      key: keyLabel('⌘' + (state.tabs.indexOf(t) + 1)),
      run: () => browser.activateTab(t.id),
    })
  }

  const openUrls = new Set(state.tabs.map((t) => t.url))

  for (const b of marks) {
    if (!match(b.title) && !match(b.url)) continue
    out.push({
      sect: 'Bookmarks',
      title: b.title,
      hint: shortUrl(b.url),
      star: true,
      run: (newTab) => (newTab ? browser.newTab(b.url) : browser.navigate(b.url)),
    })
  }

  for (const h of history) {
    if (openUrls.has(h.url)) continue
    if (!match(h.title) && !match(h.url)) continue
    out.push({
      sect: 'History',
      title: h.title,
      hint: shortUrl(h.url) + ' · ' + ago(h.ts),
      run: (newTab) => (newTab ? browser.newTab(h.url) : browser.navigate(h.url)),
    })
    if (out.filter((r) => r.sect === 'History').length >= 8) break
  }

  const tab = activeTab()
  const saved = !!tab && marks.some((b) => b.url === tab.url)
  for (const a of ACTIONS) {
    let label = a.label
    if (label === 'BOOKMARK') {
      if (!tab || tab.isNewTab) continue
      label = saved ? 'Remove bookmark' : 'Bookmark this page'
    }
    if (!match(label)) continue
    out.push({ sect: 'Actions', title: label, key: a.key, accent: true, run: a.run, keepOpen: a.keepOpen })
  }

  return out
}

function render() {
  const list = $('results')
  list.innerHTML = ''
  if (!rows.length) {
    list.innerHTML = '<div class="empty">Nothing matches that.</div>'
    return
  }

  let sect = null
  rows.forEach((row, i) => {
    if (row.sect !== sect) {
      sect = row.sect
      const h = document.createElement('div')
      h.className = 'sect'
      h.textContent = sect
      list.appendChild(h)
    }

    const el = document.createElement('div')
    el.className = 'item' + (i === cursor ? ' on' : '')

    if (row.star) {
      el.appendChild(star())
    } else if (row.favicon) {
      const img = document.createElement('img')
      img.className = 'ico'
      img.src = row.favicon
      img.onerror = () => {
        img.replaceWith(swatch(row.accent))
      }
      el.appendChild(img)
    } else {
      el.appendChild(swatch(row.accent))
    }

    const t = document.createElement('span')
    t.className = 't'
    t.textContent = row.title
    if (row.hint) {
      const em = document.createElement('em')
      em.textContent = ' · ' + row.hint
      t.appendChild(em)
    }
    el.appendChild(t)

    if (row.key) {
      const k = document.createElement('span')
      k.className = 'k'
      k.textContent = row.key
      el.appendChild(k)
    }

    el.addEventListener('mousemove', () => {
      if (cursor !== i) {
        cursor = i
        render()
      }
    })
    el.addEventListener('click', () => run(i, false))
    list.appendChild(el)
  })

  const on = list.querySelector('.item.on')
  if (on) on.scrollIntoView({ block: 'nearest' })
}

function star() {
  const s = document.createElement('span')
  s.className = 'ico star'
  s.innerHTML =
    '<svg viewBox="0 0 16 16"><path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z"/></svg>'
  return s
}

function swatch(accent) {
  const s = document.createElement('span')
  s.className = 'ico'
  if (accent) s.style.background = 'linear-gradient(135deg, #f0653a, #c2410c)'
  return s
}

function refresh() {
  if (mode === 'keys') return
  rows = build($('q').value)
  cursor = Math.min(cursor, Math.max(0, rows.length - 1))
  render()
}

function run(i, newTab) {
  const row = rows[i]
  if (!row) return
  row.run(newTab)
  if (!row.keepOpen) browser.closePalette()
}

function setMode(next) {
  mode = next
  const keys = mode === 'keys'
  $('keysheet').hidden = !keys
  $('results').hidden = keys
  $('q').placeholder = keys
    ? 'Shortcuts'
    : mode === 'url'
      ? 'Enter an address, or search'
      : 'Search tabs, history, actions — or type a URL'
  $('mode').textContent = keys ? 'shortcuts' : mode === 'url' ? 'address' : 'everything'
  $('foot').style.display = keys ? 'none' : ''
  if (!keys) refresh()
}

// -- input --------------------------------------------------------------------

$('q').addEventListener('input', () => {
  if (mode === 'keys') setMode('all')
  cursor = 0
  refresh()
})

document.addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('palette')) return
  if (e.key === 'Escape') {
    e.preventDefault()
    browser.closePalette()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    cursor = rows.length ? (cursor + 1) % rows.length : 0
    render()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    cursor = rows.length ? (cursor - 1 + rows.length) % rows.length : 0
    render()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    run(cursor, e.metaKey || e.ctrlKey)
  }
})

$('scrim').addEventListener('click', () => browser.closePalette())

// -- main process events ------------------------------------------------------

browser.onTabs((next) => {
  state = next
  renderPill()
  if (document.body.classList.contains('palette')) refresh()
})

browser.onHistory((next) => {
  history = next
  if (document.body.classList.contains('palette')) refresh()
})

browser.onBookmarks((next) => {
  marks = next || []
  if (document.body.classList.contains('palette')) refresh()
})

browser.onKeys((next) => {
  legend = next || []
  renderLegend()
  renderSheet()
})

browser.onPaletteOpen(({ mode: next }) => {
  document.body.classList.add('palette')
  document.body.classList.remove('hover')
  $('q').value = ''
  cursor = 0
  setMode(next || 'all')
  focusQuery()
})

/**
 * The overlay is display:none until the class above lands, and focus() on a
 * subtree that has not been laid out yet is simply dropped -- so this waits a
 * frame and then checks it actually took.
 */
function focusQuery(tries = 6) {
  requestAnimationFrame(() => {
    const q = $('q')
    q.focus()
    q.select()
    if (document.activeElement !== q && tries > 0) focusQuery(tries - 1)
  })
}

// Clicking anywhere in the panel keeps typing working.
document.querySelector('.panel').addEventListener('mousedown', (e) => {
  if (!e.target.closest('.item')) {
    e.preventDefault()
    $('q').focus()
  }
})

browser.onPaletteClose(() => {
  document.body.classList.remove('palette')
  $('q').blur()
})

localizeKeys()
renderPill()
