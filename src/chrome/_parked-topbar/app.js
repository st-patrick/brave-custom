'use strict'

/**
 * The chrome UI. It holds no browser logic of its own -- it renders whatever
 * `browser.onTabs` hands it and calls back into `window.browser` for actions.
 * Rewrite this file freely; the main process never reaches into the DOM.
 */

const $ = (id) => document.getElementById(id)

const els = {
  tabs: $('tabs'),
  url: $('url'),
  scheme: $('scheme'),
  shield: $('shield'),
  shieldCount: $('shieldcount'),
  back: $('back'),
  forward: $('forward'),
  reload: $('reload'),
  scrim: $('scrim'),
  panel: $('panel'),
  panelCount: $('panelcount'),
  panelDns: $('paneldns'),
}

let state = { tabs: [], activeId: null }
let addressFocused = false
let overlayOpen = false
const tabEls = new Map() // tab id -> element

// -- rendering ----------------------------------------------------------------

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null
}

function makeTabEl(id) {
  const el = document.createElement('div')
  el.className = 'tab'
  el.innerHTML =
    '<span class="mark"></span><span class="label"></span>' +
    '<button class="x" title="Close tab"><svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>'

  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault()
      browser.closeTab(id)
    } else if (e.button === 0 && !e.target.closest('.x')) {
      browser.activateTab(id)
    }
  })
  el.querySelector('.x').addEventListener('click', (e) => {
    e.stopPropagation()
    browser.closeTab(id)
  })
  return el
}

/** Replaces the favicon/spinner slot in place so favicons do not re-request. */
function renderMark(el, tab) {
  const slot = el.querySelector('.mark')
  const want = tab.loading ? 'spin' : tab.favicon ? 'img:' + tab.favicon : 'dot'
  if (slot.dataset.want === want) return
  slot.dataset.want = want

  if (tab.loading) {
    slot.outerHTML = '<span class="mark spin" data-want="' + want + '"></span>'
  } else if (tab.favicon) {
    const img = document.createElement('img')
    img.className = 'mark favicon'
    img.dataset.want = want
    img.src = tab.favicon
    img.onerror = () => {
      img.outerHTML = '<span class="mark dot" data-want="dot"></span>'
    }
    slot.replaceWith(img)
  } else {
    slot.outerHTML = '<span class="mark dot" data-want="' + want + '"></span>'
  }
}

function renderTabs() {
  const seen = new Set()
  for (const tab of state.tabs) {
    seen.add(tab.id)
    let el = tabEls.get(tab.id)
    if (!el) {
      el = makeTabEl(tab.id)
      tabEls.set(tab.id, el)
    }
    const title = tab.isNewTab ? 'New tab' : tab.title || hostOf(tab.url) || 'Loading'
    const label = el.querySelector('.label')
    if (label.textContent !== title) label.textContent = title
    el.title = title
    el.classList.toggle('active', tab.id === state.activeId)
    renderMark(el, tab)
    els.tabs.appendChild(el) // appendChild also reorders an existing child
  }
  for (const [id, el] of tabEls) {
    if (!seen.has(id)) {
      el.remove()
      tabEls.delete(id)
    }
  }
}

function renderNav() {
  const tab = activeTab()
  els.back.disabled = !tab || !tab.canGoBack
  els.forward.disabled = !tab || !tab.canGoForward
  document.body.classList.toggle('loading', !!tab && tab.loading)

  const blocked = tab ? tab.blocked : 0
  document.body.classList.toggle('shielded', blocked > 0)
  els.shieldCount.textContent = String(blocked)
  if (els.panelCount) els.panelCount.textContent = String(blocked)

  if (!addressFocused) {
    const shown = !tab || tab.isNewTab ? '' : displayUrl(tab.url)
    if (els.url.value !== shown) els.url.value = shown
    const secure = !!tab && /^https:/.test(tab.url)
    els.scheme.textContent = !tab || tab.isNewTab ? '' : secure ? 'https' : 'http'
    els.scheme.classList.toggle('secure', secure)
  }
}

function render() {
  renderTabs()
  renderNav()
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function displayUrl(url) {
  return String(url || '').replace(/^https?:\/\//, '')
}

// -- overlay (chrome view expands over the page so popovers can paint) --------

function setOverlay(open) {
  if (overlayOpen === open) return
  overlayOpen = open
  browser.setOverlay(open)
  els.scrim.hidden = !open
  if (els.panel) els.panel.hidden = !open
}

// -- wiring -------------------------------------------------------------------

$('newtab').addEventListener('click', () => browser.newTab())
$('back').addEventListener('click', () => browser.back())
$('forward').addEventListener('click', () => browser.forward())
$('reload').addEventListener('click', () => {
  const tab = activeTab()
  if (tab && tab.loading) browser.stop()
  else browser.reload()
})

$('min').addEventListener('click', () => browser.minimize())
$('max').addEventListener('click', () => browser.toggleMaximize())
$('close').addEventListener('click', () => browser.close())

$('layout').addEventListener('click', () => {
  const next = document.body.dataset.mode === 'top' ? 'left' : 'top'
  browser.setLayout({ mode: next, size: next === 'left' ? 248 : 84 })
})

els.shield.addEventListener('click', () => setOverlay(!overlayOpen))
els.scrim.addEventListener('click', () => setOverlay(false))

els.url.addEventListener('focus', () => {
  addressFocused = true
  els.url.select()
})
els.url.addEventListener('blur', () => {
  addressFocused = false
  renderNav()
})
els.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    browser.navigate(els.url.value)
    els.url.blur()
    browser.focusPage()
  } else if (e.key === 'Escape') {
    els.url.blur()
    browser.focusPage()
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlayOpen) setOverlay(false)
})

// Middle-click on empty chrome space opens a tab, like every other browser.
document.addEventListener('auxclick', (e) => {
  if (e.button === 1 && !e.target.closest('.tab')) browser.newTab()
})

// -- main process events ------------------------------------------------------

browser.onTabs((next) => {
  state = next
  render()
})

function applyLayout(layout) {
  document.body.dataset.mode = layout.mode
  document.documentElement.style.setProperty('--chrome-size', layout.size + 'px')
}

browser.onLayout(applyLayout)

browser.onWindow((win) => {
  document.body.classList.toggle('maximized', win.maximized)
  document.body.dataset.platform = win.platform
})

browser.onFocusAddress(() => {
  els.url.focus()
  els.url.select()
})

browser.info().then((info) => {
  applyLayout(info.layout)
  document.body.dataset.platform = info.window.platform
  if (info.dns && els.panelDns) {
    els.panelDns.textContent = info.dns.label + (info.dns.secure ? ' over HTTPS' : '')
    els.panelDns.title = info.dns.note
  }
})
