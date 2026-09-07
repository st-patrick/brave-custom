'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * The only surface the chrome UIs get. Both the hairline and the dock load this
 * same preload and use the parts they need, so a redesign never has to touch
 * the main process.
 */
const on = (channel) => (handler) => {
  const listener = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

contextBridge.exposeInMainWorld('browser', {
  info: () => ipcRenderer.invoke('chrome:info'),

  // tabs
  newTab: (url) => ipcRenderer.send('tab:new', url),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  activateTab: (id) => ipcRenderer.send('tab:activate', id),
  navigate: (input, id) => ipcRenderer.send('tab:navigate', { id, input }),
  back: (id) => ipcRenderer.send('tab:back', id),
  forward: (id) => ipcRenderer.send('tab:forward', id),
  reload: (id, hard) => ipcRenderer.send('tab:reload', { id, hard }),
  stop: (id) => ipcRenderer.send('tab:stop', id),
  focusPage: () => ipcRenderer.send('page:focus'),
  pageDevTools: () => ipcRenderer.send('devtools:page'),

  // dock geometry: main owns the view rect, so hover has to round-trip
  setDockHover: (on) => ipcRenderer.send('dock:hover', on),

  // command palette
  openPalette: (mode) => ipcRenderer.send('palette:open', mode || 'all'),
  closePalette: () => ipcRenderer.send('palette:close'),

  // window
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  copy: (text) => ipcRenderer.send('clipboard:write', text),

  // events
  onTabs: on('tabs:state'),
  onHistory: on('history:state'),
  onWindow: on('window:state'),
  onKeys: on('keys:legend'),
  onPaletteOpen: on('palette:open'),
  onPaletteClose: on('palette:close'),
})
