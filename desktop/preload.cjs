'use strict';
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('sashatel', Object.freeze({
  mode: 'DEMO',
  version: '0.1.0',
  platform: process.platform
}));
