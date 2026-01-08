import regions from '../data/windRegions.json' with { type: 'json' };

const DEG = {
  TROPICS: 23.5,
  MID: 55,
};

const FEATURES = Array.isArray(regions?.features) ? regions.features : [];

function normalizeLon(lon) {
  let value = lon;
  while (value < -180) value += 360;
  while (value > 180) value -= 360;
  return value;
}

function classifyZone(lat) {
  const absLat = Math.abs(lat);
  if (absLat <= DEG.TROPICS) return 'Tropics';
  if (absLat <= DEG.MID) return lat >= 0 ? 'Northern mid-latitudes' : 'Southern mid-latitudes';
  return lat >= 0 ? 'Arctic air mass' : 'Antarctic air mass';
}

function pointInRing(lat, lon, ring = []) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects =
      yi > lat !== yj > lat &&
      lon <
        ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lat, lon, coordinates = []) {
  if (!Array.isArray(coordinates) || !coordinates.length) return false;
  return coordinates.some((ring) => pointInRing(lat, lon, ring));
}

function pointInMultiPolygon(lat, lon, multipoly = []) {
  if (!Array.isArray(multipoly) || !multipoly.length) return false;
  return multipoly.some((polygon) => pointInPolygon(lat, lon, polygon));
}

function featureContains(feature, lat, lon) {
  if (!feature?.geometry) return false;
  const { type, coordinates } = feature.geometry;
  if (!coordinates) return false;
  if (type === 'Polygon') {
    return pointInPolygon(lat, lon, coordinates);
  }
  if (type === 'MultiPolygon') {
    return pointInMultiPolygon(lat, lon, coordinates);
  }
  return false;
}

export function describeRegions(lat, lon) {
  const wrappedLon = normalizeLon(lon);
  const matches = [];
  for (const feature of FEATURES) {
    if (featureContains(feature, lat, wrappedLon)) {
      matches.push(feature.properties?.name || 'Unknown region');
    }
  }

  const hemisphere = lat >= 0 ? 'Northern Hemisphere' : 'Southern Hemisphere';
  const longitudinalSector =
    wrappedLon < -30
      ? 'Americas'
      : wrappedLon < 60
      ? 'Atlantic/Europe/Africa'
      : wrappedLon < 150
      ? 'Indian Ocean/Asia'
      : 'Pacific Basin';

  const zone = classifyZone(lat);
  const landmarks = matches.length ? matches : [];

  const narrativeParts = [
    `Currently in the ${hemisphere}`,
    `tracking through the ${zone}`,
    `with flow linked to the ${longitudinalSector}.`,
  ];
  if (landmarks.length) {
    narrativeParts.push(`Nearby highlights: ${landmarks.join(', ')}.`);
  }

  return {
    hemisphere,
    zone,
    sector: longitudinalSector,
    landmarks,
    narrative: narrativeParts.join(' '),
  };
}
