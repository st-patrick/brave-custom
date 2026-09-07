'use strict'

/**
 * DNS-over-HTTPS, scoped to this browser only -- it does not touch the system
 * resolver, so the rest of the machine is unaffected.
 *
 * The point of the filtering resolvers below is that they are *both* encrypted
 * and ad-blocking, which is the combination plain "ad-blocking DNS" usually
 * costs you: most of the classic ones answer on port 53 in cleartext.
 *
 * What a resolver can and cannot see, because it decides which one you want:
 *   - It sees every HOSTNAME you look up, tied to your IP, in time order. That
 *     is browsing-history-shaped metadata, and it is the real cost.
 *   - It does NOT see paths or query strings. `?q=<search terms>` is inside the
 *     TLS session with the site; DNS resolved only `duckduckgo.com`.
 *   - It CAN lie -- a resolver returns the addresses it chooses to return. This
 *     is the mechanism the ad blocking works by, and the reason operator trust
 *     matters more than protocol here.
 * Turning DoH off does not remove the observer, it moves it: your ISP or the
 * network you are on sees the same hostnames instead, unencrypted.
 *
 * DNS blocking and the request blocker in blocker.js do different jobs and are
 * meant to stack:
 *   - DNS  kills a whole domain before a connection is opened, for every
 *          request type, but it is all-or-nothing per domain and cannot touch
 *          ads served from the site's own hostname.
 *   - Rules see the full URL and the request's initiator, so they can block one
 *          path on a domain you otherwise need, and count what they blocked.
 */

const RESOLVERS = {
  mullvad: {
    label: 'Mullvad',
    note: 'Sweden, no-logs, audited, blocks ads + trackers',
    servers: ['https://adblock.dns.mullvad.net/dns-query'],
  },
  quad9: {
    label: 'Quad9',
    note: 'Swiss non-profit, malware only, no ad blocking',
    servers: ['https://dns.quad9.net/dns-query'],
  },
  adguard: {
    label: 'AdGuard DNS',
    note: 'Cyprus company, Russian founders, blocks ads + trackers',
    servers: ['https://dns.adguard-dns.com/dns-query'],
  },
  controld: {
    label: 'Control D',
    note: 'Canada, blocks ads + trackers',
    servers: ['https://freedns.controld.com/p1'],
  },
  cloudflare: {
    label: 'Cloudflare',
    note: 'US, encrypted but no filtering',
    servers: ['https://cloudflare-dns.com/dns-query'],
  },
  system: {
    label: 'System resolver',
    note: 'unencrypted, visible to your ISP',
    servers: [],
  },
}

// Change this line to switch resolver, or run with BROWSER_DNS=cloudflare.
const DEFAULT_RESOLVER = 'mullvad'

/**
 * `secure` means DoH only, with no fallback to the system resolver -- a plain
 * DNS query is never emitted, so nothing leaks to the network you are on. The
 * tradeoff is that if the resolver is unreachable, nothing resolves at all;
 * set BROWSER_DNS=system to get out of that.
 */
function configureDns(app) {
  const key = process.env.BROWSER_DNS || DEFAULT_RESOLVER
  const resolver = RESOLVERS[key] || RESOLVERS[DEFAULT_RESOLVER]

  if (!resolver.servers.length) {
    app.configureHostResolver({ secureDnsMode: 'off', secureDnsServers: [] })
    return { key: 'system', ...RESOLVERS.system, secure: false }
  }

  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: 'secure',
    secureDnsServers: resolver.servers,
  })
  return { key, ...resolver, secure: true }
}

module.exports = { configureDns, RESOLVERS }
