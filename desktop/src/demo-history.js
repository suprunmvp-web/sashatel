/** @typedef {import('./contracts').HistoryPort} HistoryPort */
/** @implements {HistoryPort} */
export class DemoHistory {
  /** @type {import('./contracts').HistoryItem[]} */
  items = [];
  async load() { return this.items.slice(); }
  recordDemo(/** @type {import('./contracts').HistoryItem} */ item) {
    if (!this.items.some(row => row.id === item.id)) this.items.unshift(item);
  }
}
