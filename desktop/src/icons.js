const paths = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3 1-1h4l1 1 .3 2 2 1 2-.6 1.4.6 2 3.5-.2 1.5-1.6 1.3v2.4l1.6 1.3.2 1.5-2 3.5-1.4.6-2-.6-2 1-.3 2-1 1h-4l-1-1-.3-2-2-1-2 .6-1.4-.6-2-3.5.2-1.5L3.8 13v-2.4L2.2 9.3 2 7.8l2-3.5 1.4-.6 2 .6 2-1Z" transform="translate(1 2) scale(.9 .8)"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z"/>',
  backspace: '<path d="M9 4h12v16H9L2 12l7-8Z"/><path d="m12 9 6 6m0-6-6 6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  retry: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  speaker: '<path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  hangup: '<path d="M3 15v-4a15 15 0 0 1 18 0v4l-5 1v-4a10 10 0 0 0-8 0v4l-5-1Z"/>',
};
/** @param {keyof typeof paths} name */
export function icon(name) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
