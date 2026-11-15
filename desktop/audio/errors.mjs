export class AudioDeviceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AudioDeviceError';
    this.code = code;
  }
}

// Never expose native messages: they can contain device IDs or OS diagnostics.
export function audioError(error) {
  if (error instanceof AudioDeviceError) return error;
  return new AudioDeviceError({
    NotAllowedError: 'PERMISSION_DENIED', SecurityError: 'PERMISSION_DENIED',
    NotFoundError: 'NO_INPUT', DevicesNotFoundError: 'NO_INPUT',
    NotReadableError: 'DEVICE_UNAVAILABLE', TrackStartError: 'DEVICE_UNAVAILABLE',
    OverconstrainedError: 'DEVICE_UNAVAILABLE', AbortError: 'CANCELLED',
    NotSupportedError: 'UNSUPPORTED'
  }[error?.name] || 'AUDIO_FAILED');
}

export function requireValue(condition, code) {
  if (!condition) throw new AudioDeviceError(code);
}
