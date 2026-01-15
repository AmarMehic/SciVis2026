// web/src/components/windPassportPanel.js
// Standalone DOM overlay that will display a "passport" for the currently
// selected wind glyph (leaf). The component does not wire itself to the data
// source yet; instead it exposes helper methods and awaits a custom browser
// event. Future wiring can be done by dispatching `window.dispatchEvent(new
// CustomEvent('wind:select', { detail: payload }))` from the interactive wind
// component without having to touch this file again.

import { describeRegions } from '../utils/geoRegions.js';

const REGION_LON_OFFSET = 90;

/**
 * Schema describing what the passport overlay expects to receive. Everything
 * listed below is passed in the custom `wind:select` event:
 *   - `lat` / `lon`: degrees, used for location text.
 *   - `speed`: derived magnitude (sqrt(u^2 + v^2)).
 *   - `level`: wind level index for context.
 *   - `landmarks`: ordered list of regions/seas the leaf has touched.
 *
 * Additional storytelling facts (milestones, scientific notes) can be
 * bolted on by simply including more fields in the `detail` object—this panel
 * renders whatever it finds without assuming a rigid schema.
 */
const DEFAULT_EMPTY_COPY = {
  title: 'Awaiting selection',
  message:
    'Click a wind glyph to pin its journey. The passport will capture its coordinates, speed, and nearby regions.',
};

export function createWindPassportPanel({ options = {} }) {
  const position = options.position ?? 'top-right';
  const title = options.title ?? 'Passport';
  const offsetTop = Number.isFinite(options.offsetTop) ? options.offsetTop : 120;
  const offsetSide = Number.isFinite(options.offsetSide) ? options.offsetSide : 20;
  const width = Number.isFinite(options.width) ? options.width : 300;
  const eventName =
    typeof options.eventName === 'string'
      ? options.eventName
      : typeof options.passportEventName === 'string'
      ? options.passportEventName
      : 'wind:select';
  const mountNode = options.mount ?? null;
  const eventTargetOverride = options.eventTarget ?? null;
  const emptyStateCopy = {
    title: options.emptyTitle ?? DEFAULT_EMPTY_COPY.title,
    message: options.emptyMessage ?? DEFAULT_EMPTY_COPY.message,
  };

  let container = null;
  let headerValueEl = null;
  let listEl = null;
  let messageEl = null;
  let colorBadgeEl = null;
  let valueTextEl = null;
  let boundEventTarget = null;
  const rowValueEls = new Map();

  function handleWindSelect(event) {
    // The interactive leaf component will eventually emit this event.
    const detail = event?.detail || null;
    if (!detail) {
      renderEmpty(emptyStateCopy);
      return;
    }
    if (detail?.mode === 'live') {
      updateLive(detail);
      return;
    }
    renderPassport(detail);
  }

  function getDocument() {
    return typeof document !== 'undefined' ? document : null;
  }

  function getEventTarget() {
    if (eventTargetOverride) return eventTargetOverride;
    if (typeof window !== 'undefined') return window;
    return null;
  }

  function init() {
    const doc = getDocument();
    if (!doc) {
      console.warn('windPassportPanel: document is not available, skipping init');
      return;
    }

    container = doc.createElement('div');
    container.id = 'wind-passport-panel';
    container.style.cssText = `
      position: fixed;
      ${getPositionStyles(position)}
      width: ${width}px;
      padding: 18px 20px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: radial-gradient(circle at top, rgba(22,30,52,0.95), rgba(8,12,24,0.94));
      color: #f8f9ff;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      backdrop-filter: blur(14px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
      z-index: 1200;
    `;

    const header = doc.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      gap: 16px;
    `;

    const titleEl = doc.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #8fb8ff;
    `;
    header.appendChild(titleEl);

    colorBadgeEl = doc.createElement('span');
    colorBadgeEl.style.cssText = `
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.4);
      background: #ffffff;
      display: inline-block;
    `;

    headerValueEl = doc.createElement('div');
    headerValueEl.style.cssText = `
      font-variant-numeric: tabular-nums;
      font-size: 16px;
      font-weight: 600;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    valueTextEl = doc.createElement('span');
    valueTextEl.textContent = '--';
    headerValueEl.append(colorBadgeEl, valueTextEl);
    header.appendChild(headerValueEl);

    container.appendChild(header);

    listEl = doc.createElement('dl');
    listEl.style.cssText = `
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 14px;
    `;
    container.appendChild(listEl);

    messageEl = doc.createElement('div');
    messageEl.style.cssText = `
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 12px;
      color: #a6b1d7;
    `;
    container.appendChild(messageEl);

    const parent = mountNode ?? doc.body;
    if (!parent) {
      console.warn('windPassportPanel: no mount node available');
      return;
    }
    parent.appendChild(container);

    renderEmpty(emptyStateCopy);

    // Listen for upcoming events but do not fail if nobody dispatches them yet.
    boundEventTarget = getEventTarget();
    if (boundEventTarget && eventName) {
      boundEventTarget.addEventListener(eventName, handleWindSelect);
    }
  }

  function renderPassport(detail) {
    if (!container || !listEl) return;

    const { lat, lon, speed, color } = detail;
    const level = Number.isFinite(detail?.level) ? detail.level : 'n/a';
    const locationContext = resolveLocationContext(detail);

    listEl.innerHTML = '';
    rowValueEls.clear();

    addRow('Speed', formatSpeed(speed));
    addRow('Location', formatLatLon(lat, lon));
    addRow('Level', String(level));
    if (locationContext.hemisphere || locationContext.zone) {
      addRow(
        'Air mass',
        [locationContext.hemisphere, locationContext.zone].filter(Boolean).join(' · ')
      );
    }
    if (locationContext.sector) {
      addRow('Sector', locationContext.sector);
    }

    if (locationContext.itinerary.length) {
      addList('Itinerary', locationContext.itinerary);
    } else {
      addRow('Itinerary', 'No regions recorded yet');
    }

    messageEl.textContent = locationContext.narrative || 'Tracing the wind history…';
    if (valueTextEl) valueTextEl.textContent = formatSpeed(speed);
    updateColorBadge(color);
  }

  function updateLive(detail) {
    if (!container || !listEl) return;
    if (!rowValueEls.size) return;

    const speedText = formatSpeed(detail?.speed);
    const speedEl = rowValueEls.get('Speed');
    if (speedEl) speedEl.textContent = speedText;
    if (valueTextEl) valueTextEl.textContent = speedText;

    const locationEl = rowValueEls.get('Location');
    if (locationEl && Number.isFinite(detail?.lat) && Number.isFinite(detail?.lon)) {
      locationEl.textContent = formatLatLon(detail.lat, detail.lon);
    }

    if (detail?.color) updateColorBadge(detail.color);
  }

  function renderEmpty({ title, message }) {
    if (valueTextEl) valueTextEl.textContent = '--';
    if (listEl) listEl.innerHTML = '';
    if (messageEl) messageEl.textContent = message || '';
    updateColorBadge(null);
    rowValueEls.clear();

    // Provide a friendly headline message
    if (listEl) {
      addRow('Status', title);
    }
  }

  function addRow(label, value) {
    if (!listEl) return;
    const doc = getDocument();
    if (!doc) return;
    const dt = doc.createElement('dt');
    dt.textContent = label;
    dt.style.cssText = 'color: #8ea4c7; font-weight: 500;';

    const dd = doc.createElement('dd');
    dd.style.cssText = 'margin: 0; white-space: pre-line; color: #fefefe;';
    dd.textContent = value ?? '—';

    listEl.appendChild(dt);
    listEl.appendChild(dd);
    rowValueEls.set(label, dd);
  }

  function addList(label, items) {
    if (!listEl) return;
    const doc = getDocument();
    if (!doc) return;
    const dt = doc.createElement('dt');
    dt.textContent = label;
    dt.style.cssText = 'color: #8ea4c7; font-weight: 500;';

    const dd = doc.createElement('dd');
    dd.style.cssText = 'margin: 0;';
    const ul = doc.createElement('ul');
    ul.style.cssText = 'padding-left: 16px; margin: 0; color: #fefefe;';
    items.forEach((item) => {
      const li = doc.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    dd.appendChild(ul);

    listEl.appendChild(dt);
    listEl.appendChild(dd);
    rowValueEls.set(label, dd);
  }

  function formatSpeed(speed) {
    return Number.isFinite(speed) ? `${speed.toFixed(2)} m/s` : 'n/a';
  }

  function formatLatLon(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'n/a';
    return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  }

  function resolveLocationContext(detail) {
    const lat = detail?.lat;
    const lon = detail?.lon;
    const locationText = formatLatLon(lat, lon);
    const fallback = {
      locationText,
      hemisphere: detail?.hemisphere ?? null,
      zone: detail?.zone ?? null,
      sector: detail?.sector ?? null,
      itinerary: Array.isArray(detail?.landmarks) ? detail.landmarks : [],
      narrative: typeof detail?.narrative === 'string' ? detail.narrative : '',
    };

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return fallback;
    }

    const regionLon = adjustRegionLongitude(lon);
    const region = describeRegions(lat, regionLon);

    return {
      locationText,
      hemisphere: region?.hemisphere ?? fallback.hemisphere ?? null,
      zone: region?.zone ?? fallback.zone ?? null,
      sector: region?.sector ?? fallback.sector ?? null,
      itinerary: Array.isArray(region?.landmarks) && region.landmarks.length
        ? region.landmarks
        : fallback.itinerary,
      narrative: region?.narrative || fallback.narrative || '',
    };
  }

  function adjustRegionLongitude(lon, offset = REGION_LON_OFFSET) {
    if (!Number.isFinite(lon)) return lon;
    let value = lon - offset;
    while (value < -180) value += 360;
    while (value > 180) value -= 360;
    return value;
  }

  function updateColorBadge(hex) {
    if (!colorBadgeEl) return;
    colorBadgeEl.style.background = hex || '#ffffff';
  }

  function getPositionStyles(pos) {
    switch (pos) {
      case 'top-right':
        return `top: ${offsetTop}px; right: ${offsetSide}px;`;
      case 'bottom-left':
        return `bottom: ${offsetSide}px; left: ${offsetSide}px;`;
      case 'bottom-right':
        return `bottom: ${offsetSide}px; right: ${offsetSide}px;`;
      case 'top-left':
      default:
        return `top: ${offsetTop}px; left: ${offsetSide}px;`;
    }
  }

  function dispose() {
    if (boundEventTarget && eventName) {
      boundEventTarget.removeEventListener(eventName, handleWindSelect);
    }
    if (container?.parentElement) {
      container.parentElement.removeChild(container);
    }
    container = null;
    headerValueEl = null;
    listEl = null;
    messageEl = null;
    boundEventTarget = null;
    rowValueEls.clear();
  }

  return {
    group: null, // DOM-only component; nothing to attach to the Three.js scene.
    init,
    update() {},
    dispose,
  };
}
