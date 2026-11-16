/** @typedef {import('./trunks').Trunk} Trunk */

/** @returns {import('./trunks').TrunkApi} */
export function createMockTrunkApi() {
  /** @type {Map<string, Trunk>} */
  const trunks = new Map();
  let nextId = 1;
  /** @param {string} id */
  function requireTrunk(id) {
    const trunk = trunks.get(id);
    if (!trunk) throw new Error('TRUNK_NOT_FOUND');
    return trunk;
  }

  return {
    async list() {
      return Array.from(trunks.values(), trunk => ({ ...trunk }));
    },
    async create({ registrar, login, password, auth_mode }) {
      if (registrar.toLowerCase() !== 'pbx.uiscom.ru:5060' || !login.trim() || !password ||
          auth_mode !== 'registration_credentials') {
        throw new Error('INVALID_TRUNK');
      }
      if (trunks.size) throw new Error('TRUNK_EXISTS');
      /** @type {Trunk} */
      const trunk = { id: String(nextId++), registrar: registrar.toLowerCase(), auth_mode, status: 'degraded' };
      trunks.set(trunk.id, trunk);
      return { ...trunk };
    },
    async retry(id) {
      return { ...requireTrunk(id) };
    },
    async remove(id) {
      trunks.delete(id);
    },
  };
}
