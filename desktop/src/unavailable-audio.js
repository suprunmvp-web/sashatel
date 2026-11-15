/** No parallel audio implementation: the Audio Device Service supplies this port later. */
export class UnavailableAudio {
  /** @returns {Readonly<import('./contracts').AudioSnapshot>} */
  getSnapshot() {
    return Object.freeze({ available: false, permission: 'unknown', outputSelection: false, inputs: [], outputs: [], inputId: '', outputId: '',
      volume: 0, testing: null, level: 0, result: '', message: 'Аудиосервис не подключён. Выбор устройств и проверка звука будут доступны после интеграции.' });
  }
  subscribe(/** @type {(snapshot: Readonly<import('./contracts').AudioSnapshot>) => void} */ _listener) { return () => {}; }
  async selectInput(/** @type {string} */ _id) { throw new Error('Аудиосервис недоступен'); }
  async selectOutput(/** @type {string} */ _id) { throw new Error('Аудиосервис недоступен'); }
  async setVolume(/** @type {number} */ _volume) { throw new Error('Аудиосервис недоступен'); }
  async testMicrophone() { throw new Error('Аудиосервис недоступен'); }
  async testSpeaker() { throw new Error('Аудиосервис недоступен'); }
  async stopTest() {}
  async requestPermission() { throw new Error('Аудиосервис недоступен'); }
}
