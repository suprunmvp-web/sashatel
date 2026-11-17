import { requireValue } from './errors.mjs';

export async function discoverDevices(mediaDevices) {
  requireValue(mediaDevices?.enumerateDevices, 'UNSUPPORTED');
  const devices = await mediaDevices.enumerateDevices();
  const list = kind => devices.filter(device => device.kind === kind).map((device, index) => ({
    id: device.deviceId,
    label: device.label || `${kind === 'audioinput' ? 'Микрофон' : 'Выход'} ${index + 1}`,
    // Empty IDs before permission are deliberately not selectable.
    selectable: Boolean(device.deviceId)
  }));
  return { inputs: list('audioinput'), outputs: list('audiooutput') };
}

export function validateDeviceId(id) {
  requireValue(typeof id === 'string' && id.length <= 1024 && !/[\u0000-\u001f]/.test(id), 'INVALID_ARGUMENT');
}
