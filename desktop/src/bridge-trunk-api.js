/** @template T @param {Promise<import('./trunks').TrunkResult<T>>} response @returns {Promise<T>} */
async function unwrap(response) {
  const result = await response.catch(() => { throw new Error('BACKEND_UNREACHABLE'); });
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

/** @param {import('./trunks').TrunkBridge | undefined} bridge @returns {import('./trunks').TrunkApi} */
export function createBridgeTrunkApi(bridge) {
  function unavailable() { return Promise.reject(new Error('BACKEND_UNCONFIGURED')); }
  return {
    list: () => bridge ? unwrap(bridge.list()) : unavailable(),
    create: input => bridge ? unwrap(bridge.create(input)) : unavailable(),
    remove: id => bridge ? unwrap(bridge.remove(id)) : unavailable(),
  };
}
