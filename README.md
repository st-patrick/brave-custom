# brave-custom

A browser with no frame, no title bar, no menu and no tab strip. The page is
full-bleed across the whole window; the only chrome is a floating pill at the
bottom. Everything else is a key.

Built on Electron, so the engine is real Chromium — which is what makes the
request blocker, encrypted DNS and multi-view tab handling possible.

## Run it

```
npm install
npm start
```

`tools/install-shortcut.ps1` adds a Desktop and Start Menu entry that launches
it detached from any terminal, still from source — so edits apply on the next
launch and the chrome-UI hot reload keeps working. It is deliberately not a
packaged build.

## Keys

There is no menu. Bindings live in one table in `src/main/shortcuts.js` and are
matched off `before-input-event` on every web contents. That same table renders
the hover legend and the `Ctrl+/` sheet, so the printed legend cannot drift from
what the keys actually do.

| | |
|---|---|
| `Ctrl+K` | command palette — tabs, history, actions |
| `Ctrl+L` | address — a URL or a search |
| `Ctrl+/` | every binding, as a sheet |
| `Ctrl+D` | bookmark this page, or remove it |
| `Ctrl+T` / `Ctrl+W` | new tab / close tab |
| `Ctrl+1…9`, `Ctrl+Tab` | jump to a tab, cycle |
| `Alt+←` `Alt+→`, `Ctrl+R` | back, forward, reload |
| `Ctrl+Alt+←↑→↓` | move the window (there is no drag handle) |
| `Ctrl+Alt+Shift+←↑→↓` | resize |
| `Ctrl+Alt+Enter` / `C` / `H` / `F` | maximize · centre · minimize · fullscreen |
| `Ctrl+Shift+Q` | quit |

## Layout

```
src/main/main.js        window, view geometry, palette state, IPC
src/main/tabs.js        one WebContentsView per tab
src/main/shortcuts.js   every binding, and the legend generated from it
src/main/blocker.js     request blocking, referrer trimming, permissions
src/main/dns.js         DNS-over-HTTPS, scoped to this browser only
src/main/bookmarks.js   the one thing that persists, as a JSON file
src/preload/chrome.js   the entire API the UI is allowed to call
src/chrome/             the UI — plain HTML/CSS/JS, no build step
designs/                the five directions this was chosen from
```

Bookmarks are pushed into the new tab page one-way, with `executeJavaScript`.
Every tab shares one `webPreferences`, so giving that page a preload would hand
the same API to every website it later navigates to.

The chrome holds no browser logic: it renders whatever arrives on `onTabs` and
calls back through `window.browser`. `src/chrome/` can be rewritten in anything
without touching the main process.

### Geometry

The dock is a `WebContentsView` whose rect main owns. Collapsed it is barely
bigger than the pill, so it swallows as few clicks as possible; it grows upward
on hover for the key legend, and expands to the whole window when the palette
opens. Hover has to round-trip through IPC because CSS cannot paint outside the
view's own bounds.

## Privacy

- A readable tracker blocklist in `src/main/blocker.js`, with per-tab counts on
  the pill's shield. This is the seam where EasyList would go.
- Cross-site referrers trimmed to the origin; identifying client-hint headers
  dropped.
- The Electron and app-name tokens are stripped from the user agent, so it
  presents as plain Chrome. Less to fingerprint — and it stops sites that filter
  on the shell's name from serving a block page.
- Overlay scrollbars, so no permanently parked gutter down the right edge.
- Site permissions denied by default — there is no prompt UI yet, and a silent
  deny beats a silent grant.
- DNS-over-HTTPS in `secure` mode (no cleartext fallback, ever), defaulting to
  Mullvad's ad-blocking resolver. `BROWSER_DNS=quad9 npm start` to switch;
  `BROWSER_DNS=system` to turn it off.

A resolver sees every hostname you visit tied to your IP — but never paths or
query strings, which are inside TLS. Turning DoH off does not remove the
observer, it moves it to your ISP.

## Not there yet

- No context menu — Electron ships none, and right-click currently does nothing
- No find-in-page
- Tabs and history are in-memory; they do not survive a restart. Bookmarks do —
  they live in `bookmarks.json` under the app's userData directory
- No zoom
- If the DoH resolver is unreachable nothing resolves, with no message saying so
