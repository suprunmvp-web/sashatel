const messages = {
  PERMISSION_DENIED: 'Доступ к микрофону запрещён. Проверьте разрешения системы.',
  NO_INPUT: 'Микрофон не найден.', NO_OUTPUT: 'Устройство воспроизведения не найдено.',
  DEVICE_LOST: 'Аудиоустройство отключено. Проверьте подключение.',
  DEVICE_UNAVAILABLE: 'Аудиоустройство недоступно.', BUSY: 'Аудиоустройство занято.',
  SUSPENDED: 'Аудио приостановлено. Проверьте устройства после пробуждения.',
  AUDIO_INTERRUPTED: 'Работа аудио прервана.', OUTPUT_SELECTION_UNSUPPORTED: 'Выбор выхода не поддерживается системой.',
};

/** UI translation of PR #3's existing service. No media APIs, timers, graphs or device ownership. */
export class AudioServiceFacade {
  constructor(/** @type {import('./contracts').PublishedAudioService} */ service) { this.service = service; }
  /** @returns {Readonly<import('./contracts').AudioSnapshot>} */
  getSnapshot() {
    const s = this.service.getState();
    const inputs = s.devices.inputs.filter(d => d.selectable);
    const outputs = s.devices.outputs.filter(d => d.selectable);
    const last = s.lastTest;
    const result = !last ? '' : last.reason !== 'completed' ? 'Проверка прервана. Проверьте устройство и повторите.'
      : last.kind === 'microphone' ? last.signalDetected ? 'Входной сигнал обнаружен.' : 'Входной сигнал не обнаружен.'
        : 'Тестовый сигнал отправлен на выход. Проверьте, слышали ли вы его в гарнитуре.';
    const code = s.error?.code;
    return {
      available: true, permission: s.permission, outputSelection: s.capabilities.outputSelection,
      inputs: inputs.length ? [{id: '', label: 'Системный микрофон'}, ...inputs] : [],
      outputs: outputs.length ? [{id: '', label: 'Системный выход'}, ...outputs] : [],
      inputId: s.inputId, outputId: s.outputId, volume: s.volume,
      testing: s.testing === 'playback' ? 'speaker' : s.testing,
      // RMS from the service's measured PCM; UI scales only, never fabricates a signal.
      level: s.meter ? Math.min(1, Math.max(0, s.meter.rms)) : 0,
      result,
      message: code ? messages[/** @type {keyof typeof messages} */ (code)] || 'Ошибка аудио. Проверьте устройство и повторите.'
        : !s.devices.inputs.length && !s.devices.outputs.length ? 'Аудиоустройства не найдены. Подключите гарнитуру и проверьте разрешения.' : '',
    };
  }
  subscribe(/** @type {(snapshot: Readonly<import('./contracts').AudioSnapshot>) => void} */ listener) {
    return this.service.subscribe(() => listener(this.getSnapshot()));
  }
  selectInput(/** @type {string} */ id) { return this.service.selectInput(id); }
  selectOutput(/** @type {string} */ id) { return this.service.selectOutput(id); }
  async setVolume(/** @type {number} */ volume) { this.service.setPlaybackVolume(volume); }
  async testMicrophone() { await this.service.testMicrophone(); }
  async testSpeaker() { await this.service.testPlayback(); }
  async stopTest() { this.service.stopTests(); }
  async requestPermission() { await this.service.requestPermission(); }
}
