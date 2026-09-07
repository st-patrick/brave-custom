'use strict'

// A deliberately small, readable tracker blocklist. This is the seam where you
// would later drop in EasyList/EasyPrivacy parsing -- the rest of the app only
// depends on `shouldBlock(url, initiator)` and the per-tab counters.
const BLOCKED_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'analytics.google.com',
  'scorecardresearch.com',
  'quantserve.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'sharethrough.com',
  'moatads.com',
  'amazon-adsystem.com',
  'facebook.net',
  'connect.facebook.net',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'branch.io',
  'appsflyer.com',
  'adjust.com',
  'chartbeat.com',
  'newrelic.com',
  'nr-data.net',
  'bugsnag.com',
  'fullstory.com',
  'mouseflow.com',
  'clarity.ms',
  'yandex.ru',
  'mc.yandex.ru',
  'bat.bing.com',
  'ads.linkedin.com',
  'analytics.tiktok.com',
  'ads.twitter.com',
  'static.ads-twitter.com',
]

const blockedSet = new Set(BLOCKED_HOSTS)

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** Matches `host` and any subdomain of an entry in the list. */
function isBlockedHost(host) {
  if (!host) return false
  if (blockedSet.has(host)) return true
  let i = host.indexOf('.')
  while (i !== -1) {
    if (blockedSet.has(host.slice(i + 1))) return true
    i = host.indexOf('.', i + 1)
  }
  return false
}

/**
 * Installs request blocking and a default-deny permission policy on `session`.
 * `onBlocked(webContentsId, host)` is called for every blocked request so the
 * UI can show a per-tab shield count.
 */
function installBlocker(session, onBlocked) {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const host = hostOf(details.url)
    if (details.resourceType !== 'mainFrame' && isBlockedHost(host)) {
      onBlocked(details.webContentsId, host)
      return callback({ cancel: true })
    }
    callback({})
  })

  // Strip the referrer down to the origin on cross-site requests, and drop the
  // client-hint headers that identify the exact browser build.
  session.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    delete headers['Sec-CH-UA-Full-Version-List']
    delete headers['Sec-CH-UA-Full-Version']
    delete headers['Sec-CH-UA-Arch']
    delete headers['Sec-CH-UA-Model']
    delete headers['Sec-CH-UA-Bitness']
    if (headers.Referer) {
      const from = hostOf(headers.Referer)
      const to = hostOf(details.url)
      if (from && to && from !== to) {
        try {
          headers.Referer = new URL(headers.Referer).origin + '/'
        } catch {
          delete headers.Referer
        }
      }
    }
    callback({ requestHeaders: headers })
  })

  // Camera, mic, location, notifications and friends are denied outright --
  // there is no prompt UI yet, and a silent deny beats a silent grant. These
  // few are allowed because denying them visibly breaks ordinary pages.
  const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])
  session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  )
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
}

module.exports = { installBlocker, isBlockedHost, BLOCKED_HOSTS }
