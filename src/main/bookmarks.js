'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

/**
 * Bookmarks, kept as one JSON file in the app's userData directory.
 *
 * History is deliberately in-memory and disposable; bookmarks are the opposite,
 * so they are the one thing in here that survives a restart. Small enough that
 * the whole list is read once at boot and rewritten on every change -- no
 * database, and the file stays hand-editable.
 */

let file = null
let items = [] // newest first: { url, title, addedAt }

// The links the new tab page used to hardcode. Seeded on first run so the page
// is never empty, and editable from then on like any other bookmark.
const SEED = [
  { url: 'https://duckduckgo.com', title: 'DuckDuckGo' },
  { url: 'https://news.ycombinator.com', title: 'Hacker News' },
  { url: 'https://lobste.rs', title: 'Lobsters' },
  { url: 'https://github.com', title: 'GitHub' },
  { url: 'https://developer.mozilla.org', title: 'MDN' },
]

function load() {
  file = path.join(app.getPath('userData'), 'bookmarks.json')
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    items = Array.isArray(raw) ? raw.filter((b) => b && typeof b.url === 'string') : []
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('bookmarks unreadable, starting fresh:', err.message)
    items = SEED.map((b) => ({ ...b, addedAt: Date.now() }))
    save()
  }
  return list()
}

/** Write to a sibling temp file first, so a crash mid-write cannot truncate it. */
function save() {
  if (!file) return
  const tmp = file + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2))
    fs.renameSync(tmp, file)
  } catch (err) {
    console.warn('could not save bookmarks:', err.message)
  }
}

function list() {
  return items.map((b) => ({ ...b }))
}

function has(url) {
  return items.some((b) => b.url === url)
}

function add(url, title) {
  if (!url || !/^https?:/.test(url) || has(url)) return false
  items.unshift({ url, title: title || url, addedAt: Date.now() })
  save()
  return true
}

function remove(url) {
  const at = items.findIndex((b) => b.url === url)
  if (at === -1) return false
  items.splice(at, 1)
  save()
  return true
}

/** Returns true if the page ended up bookmarked. */
function toggle(url, title) {
  if (has(url)) {
    remove(url)
    return false
  }
  return add(url, title)
}

module.exports = { load, list, has, add, remove, toggle }
