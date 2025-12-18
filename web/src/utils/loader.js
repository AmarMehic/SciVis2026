// Shared loader cache for GLB/textures so components can reuse assets.
export function createAssetCache() {

  const cache = new Map();

  return {
    get(key) { return cache.get(key); },
    set(key, value) { cache.set(key, value); return value; },
    has(key) { return cache.has(key); },
    delete(key) { return cache.delete(key); },
    clear() { cache.clear(); }
  };

}
