## windVectors.js

Komponenta riše vetrne vektorje na globusu iz JSON datoteke oblike:
```json
{
  "meta": { "grid": { "lon": [...], "lat": [...] }, "units": "m/s" },
  "u": [[...]],  // oblika [lat, lon]
  "v": [[...]]
}
```

V `web/src/main.js` se podatki (`uv_small.json`) uvozijo in s funkcijo `renderWindVectors` narišejo tangentne linije (projekcija v lokalni tangentni ravnini).

Nastavitve (v `main.js`):
- `stride`: razredčenje vzorcev (večja vrednost = redkejši vektorji).
- `speedThreshold`: minimalna hitrost za risanje.
- `opacity`, `color`: videz črt.
- `lift`: dvig nad površjem, da se izogne zarisovanju v globus.

Za spremembo gostote/barve/dolžine prilagodi opcije v `createWindComponent` (v `main.js`) in osveži stran. Pričakovan JSON prihaja iz pretvornika `data/scripts/cubed_sphere_to_latlon.py`.
