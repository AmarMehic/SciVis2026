// web/src/utils/StreamLoader.js
export default class StreamLoader {
  constructor(baseUrl = '') {
    if (!baseUrl) {
      const env = typeof window !== 'undefined' && window.__BACKEND_URL__;
      this.baseUrl = (env || (location.protocol + '//' + location.hostname + ':8000')).replace(/\/$/, '');
    } else {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    }
  }

  async fetchFaceTile(face, z = 0, x = 0, y = 0, time = 0) {
    const url = `${this.baseUrl}/tiles/${face}/${z}/${x}/${y}?time=${time}`;
    console.info('StreamLoader.fetchFaceTile ->', url);
    const resp = await fetch(url);
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Failed fetching ${url}: ${resp.status} ${txt}`);
    }
    const width = parseInt(resp.headers.get('X-Width') || '0', 10);
    const height = parseInt(resp.headers.get('X-Height') || '0', 10);
    const components = parseInt(resp.headers.get('X-Components') || '2', 10);
    const dtype = resp.headers.get('X-Dtype') || 'float32';
    const buffer = await resp.arrayBuffer();
    if (dtype !== 'float32') throw new Error('Unsupported dtype ' + dtype);
    const data = new Float32Array(buffer);
    console.info(`StreamLoader: fetched face=${face} size=${width}x${height} bytes=${buffer.byteLength}`);

    // Compute approximate lon/lat bounds for root tile per-face using 3x2 layout
    // face_x = face % 3, face_y = Math.floor(face / 3)
    const faceX = face % 3;
    const faceY = Math.floor(face / 3);
    const lon0 = (faceX / 3) * 360 - 180;
    const lon1 = ((faceX + 1) / 3) * 360 - 180;
    const lat1 = 90 - (faceY / 2) * 180; // top
    const lat0 = 90 - ((faceY + 1) / 2) * 180; // bottom

    return { face, z, x, y, width, height, components, data, lon0, lon1, lat0, lat1 };
  }

  async loadGlobalSnapshot(time = 0, onFaceLoaded = null) {
    const faces = new Array(6);
    
    // Fetch all 6 faces in parallel using Promise.all
    const promises = Array.from({length: 6}, (_, face) => 
      this.fetchFaceTile(face, 0, 0, 0, time)
        .then(tile => {
          faces[face] = tile;
          console.info(`StreamLoader: loaded face ${face}`);
          // Progressive callback: render this face immediately as it arrives
          if (onFaceLoaded) {
            onFaceLoaded(face, tile);
          }
          return tile;
        })
        .catch(err => {
          console.error(`Failed to fetch face ${face}:`, err);
          return null;
        })
    );
    
    await Promise.all(promises);
    console.info(`StreamLoader: loaded ${faces.filter(f => f !== null).length}/6 faces`);
    return faces.filter(f => f !== null);
  }
}
