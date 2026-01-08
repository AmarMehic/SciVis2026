// web/src/StreamClient.js
export default class StreamClient {
  constructor(baseUrl = '') {
    // Default to explicit backend host in dev if none provided.
    if (!baseUrl) {
      // Allow overriding via a small global `window.__BACKEND_URL__` if desired.
      const env = typeof window !== 'undefined' && window.__BACKEND_URL__;
      this.baseUrl = (env || (location.protocol + '//' + location.hostname + ':8000')).replace(/\/$/, '');
    } else {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    // Cache with expiration: key -> {tile, timestamp}
    this._cache = new Map();
    this._cacheExpiry = 10 * 60 * 1000; // 10 minutes in milliseconds
    // in-flight fetch promises to dedupe concurrent requests
    this._inFlight = new Map();
  }

  async getTile(time, z, x, y) {
    // use integer timestep (frames are integer seconds), clamp to minimum 0
    const t = Math.max(0, Math.floor(Number(time)));
    const key = `${t}:${z}:${x}:${y}`;

    // Check cache with expiration
    const cached = this._cache.get(key);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this._cacheExpiry) {
        return cached.tile;
      } else {
        // Expired, remove from cache
        this._cache.delete(key);
      }
    }
    
    if (this._inFlight.has(key)) return this._inFlight.get(key);

    const url = `${this.baseUrl}/tile/${t}/${z}/${x}/${y}`;
    const p = (async () => {
      const resp = await fetch(url);
      if (!resp.ok) {
      // try to read JSON error
      let txt = await resp.text();
      try {
        const j = JSON.parse(txt);
          throw new Error(`Tile fetch failed ${resp.status} ${url}: ${j.detail ?? JSON.stringify(j)}`);
      } catch (_) {
          throw new Error(`Tile fetch failed ${resp.status} ${url}: ${txt}`);
      }
    }

    const width = parseInt(resp.headers.get('X-Width') || '0', 10);
    const height = parseInt(resp.headers.get('X-Height') || '0', 10);
    const components = parseInt(resp.headers.get('X-Components') || '2', 10);
    const dtype = resp.headers.get('X-Dtype') || 'float32';
    
    // Parse coordinate headers for gnomonic projection
    const face = parseInt(resp.headers.get('X-Face') || '0', 10);
    const projection = resp.headers.get('X-Projection') || 'equatorial';
    const faceWidth = parseInt(resp.headers.get('X-Face-Width') || '1440', 10);
    const faceHeight = parseInt(resp.headers.get('X-Face-Height') || '1440', 10);
    const faceX0 = parseInt(resp.headers.get('X-Face-X0') || '0', 10);
    const faceX1 = parseInt(resp.headers.get('X-Face-X1') || '1440', 10);
    const faceY0 = parseInt(resp.headers.get('X-Face-Y0') || '0', 10);
    const faceY1 = parseInt(resp.headers.get('X-Face-Y1') || '1440', 10);
    const lon00 = parseFloat(resp.headers.get('X-Lon00') || '0');
    const lat00 = parseFloat(resp.headers.get('X-Lat00') || '0');
    const lon10 = parseFloat(resp.headers.get('X-Lon10') || '0');
    const lat10 = parseFloat(resp.headers.get('X-Lat10') || '0');
    const lon01 = parseFloat(resp.headers.get('X-Lon01') || '0');
    const lat01 = parseFloat(resp.headers.get('X-Lat01') || '0');
    const lon11 = parseFloat(resp.headers.get('X-Lon11') || '0');
    const lat11 = parseFloat(resp.headers.get('X-Lat11') || '0');
    
    console.log(`Tile z=${z}/${x}/${y}: face=${face}, face_region=(${faceX0},${faceY0})-(${faceX1},${faceY1}) in ${faceWidth}x${faceHeight}`);

    const contentType = resp.headers.get('content-type') || '';
    const buffer = await resp.arrayBuffer();

    // If server returned JSON or text mistakenly, surface it
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      const txt = new TextDecoder().decode(buffer);
      try {
        const j = JSON.parse(txt);
        throw new Error(`Tile fetch returned JSON ${url}: ${j.detail ?? JSON.stringify(j)}`);
      } catch (_) {
        throw new Error(`Tile fetch returned text ${url}: ${txt}`);
      }
    }

    const actualBytes = buffer.byteLength;
    const expectedBytes = width * height * components * 4;
    if (expectedBytes > 0 && actualBytes !== expectedBytes) {
      // try to decode as text to give more info
      const txt = new TextDecoder().decode(buffer.slice(0, Math.min(1024, buffer.byteLength)));
      throw new Error(`Tile payload size mismatch ${url}: got ${actualBytes} bytes, expected ${expectedBytes}. Preview: ${txt}`);
    }

      let data;
      if (dtype === 'float32') data = new Float32Array(buffer);
      else throw new Error('Unsupported dtype ' + dtype);

      const out = { 
        width, height, components, dtype, data, z, x, y,
        // Coordinate info from server
        face, projection,
        faceWidth, faceHeight, faceX0, faceX1, faceY0, faceY1,
        lon00, lat00, lon10, lat10, lon01, lat01, lon11, lat11
      };
      // Store with timestamp for expiration
      this._cache.set(key, { tile: out, timestamp: Date.now() });
      return out;
    })();

    this._inFlight.set(key, p);
    try {
      const res = await p;
      return res;
    } finally {
      this._inFlight.delete(key);
    }
  }

  // Fetch all tiles for the entire globe at given zoom level
  // Returns array of tiles
  async getFrame(time, visibleBounds = null) {
    // visibleBounds: {minLat,maxLat,minLon,maxLon,zoom}
    const zoom = visibleBounds?.zoom ?? 0; // Default to z=0 (most zoomed out)

    const tilesPerFace = 1 << zoom;
    const globalTilesX = tilesPerFace * 3; // 3 faces across
    const globalTilesY = tilesPerFace * 2; // 2 faces down

    // Fetch ALL tiles for the globe in parallel
    const promises = [];
    for (let y = 0; y < globalTilesY; y++) {
      for (let x = 0; x < globalTilesX; x++) {
        promises.push(this.getTile(time, zoom, x, y));
      }
    }

    const tiles = await Promise.all(promises);
    console.log(`Fetched ${tiles.length} tiles in parallel for time=${time} zoom=${zoom}`);
    return tiles;
  }
}
