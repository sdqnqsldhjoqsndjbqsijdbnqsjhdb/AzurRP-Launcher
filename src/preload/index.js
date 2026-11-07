'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (!response || response.ok !== true) {
    const error = new Error(response?.error?.message || 'Une erreur est survenue.');
    error.code = response?.error?.code || 'UNEXPECTED_ERROR';
    error.details = response?.error?.details ?? null;
    throw error;
  }
  return response.data;
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('azur', {
  bootstrap: () => invoke('app:bootstrap'),

  auth: {
    login: (credentials) => invoke('auth:login', credentials),
    register: (payload) => invoke('auth:register', payload),
    logout: () => invoke('auth:logout')
  },

  content: {
    get: () => invoke('content:get')
  },

  server: {
    status: (force = false) => invoke('server:status', Boolean(force))
  },

  settings: {
    save: (patch) => invoke('settings:save', patch),
    reset: () => invoke('settings:reset')
  },

  system: {
    info: () => invoke('system:info'),
    detectJava: () => invoke('system:detectJava')
  },

  dialog: {
    selectDirectory: (options) => invoke('dialog:selectDirectory', options),
    selectJava: (options) => invoke('dialog:selectJava', options)
  },

  game: {
    launch: () => invoke('game:launch'),
    state: () => invoke('game:state'),
    openFolder: () => invoke('game:openFolder'),
    openLogs: () => invoke('game:openLogs'),
    onEvent: (callback) => subscribe('game:event', callback)
  },

  app: {
    openExternal: (url) => invoke('app:openExternal', url),
    testApi: (url) => invoke('app:testApi', url)
  },

  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
    onMaximized: (callback) => subscribe('window:maximized', callback)
  }
});
