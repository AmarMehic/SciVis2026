// web/src/components/windPassportPanel.js
// Standalone DOM overlay that will display a "passport" for the currently
// selected wind glyph (leaf). The component does not wire itself to the data
// source yet; instead it exposes helper methods and awaits a custom browser
// event. Future wiring can be done by dispatching `window.dispatchEvent(new
// CustomEvent('wind:select', { detail: payload }))` from the interactive wind
// component without having to touch this file again.

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

  let container = null;
  let headerValueEl = null;
  let listEl = null;
  let messageEl = null;
  let colorBadgeEl = null;
  let valueTextEl = null;

  function handleWindSelect(event) {
    // The interactive leaf component will eventually emit this event.
    const detail = event?.detail || null;
    if (!detail) {
      renderEmpty(DEFAULT_EMPTY_COPY);
      return;
    }
    renderPassport(detail);
  }

  function init() {
    container = document.createElement('div');
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

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      gap: 16px;
    `;

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #8fb8ff;
    `;
    header.appendChild(titleEl);

    colorBadgeEl = document.createElement('span');
    colorBadgeEl.style.cssText = `
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.4);
      background: #ffffff;
      display: inline-block;
    `;

    headerValueEl = document.createElement('div');
    headerValueEl.style.cssText = `
      font-variant-numeric: tabular-nums;
      font-size: 16px;
      font-weight: 600;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    valueTextEl = document.createElement('span');
    valueTextEl.textContent = '--';
    headerValueEl.append(colorBadgeEl, valueTextEl);
    header.appendChild(headerValueEl);

    container.appendChild(header);

    listEl = document.createElement('dl');
    listEl.style.cssText = `
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 14px;
    `;
    container.appendChild(listEl);

    messageEl = document.createElement('div');
    messageEl.style.cssText = `
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 12px;
      color: #a6b1d7;
    `;
    container.appendChild(messageEl);

    document.body.appendChild(container);

    renderEmpty(DEFAULT_EMPTY_COPY);

    // Listen for upcoming events but do not fail if nobody dispatches them yet.
    window.addEventListener('wind:select', handleWindSelect);
  }

  function renderPassport(detail) {
    if (!container || !listEl) return;

    const {
      lat,
      lon,
      speed,
      level = detail?.level ?? 'n/a',
      zone,
      hemisphere,
      sector,
      narrative,
      landmarks,
      color,
    } = detail;

    listEl.innerHTML = '';

    addRow('Speed', formatSpeed(speed));
    addRow('Location', formatLatLon(lat, lon));
    addRow('Level', String(level));
    if (hemisphere || zone) {
      addRow('Air mass', [hemisphere, zone].filter(Boolean).join(' · '));
    }
    if (sector) {
      addRow('Sector', sector);
    }

    if (Array.isArray(landmarks) && landmarks.length) {
      addList('Itinerary', landmarks);
    } else {
      addRow('Itinerary', 'No regions recorded yet');
    }

    messageEl.textContent = narrative || 'Tracing the wind history…';
    if (valueTextEl) valueTextEl.textContent = formatSpeed(speed);
    updateColorBadge(color);
  }

  function renderEmpty({ title, message }) {
    if (valueTextEl) valueTextEl.textContent = '--';
    if (listEl) listEl.innerHTML = '';
    if (messageEl) messageEl.textContent = message || '';
    updateColorBadge(null);

    // Provide a friendly headline message
    if (listEl) {
      addRow('Status', title);
    }
  }

  function addRow(label, value) {
    if (!listEl) return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    dt.style.cssText = 'color: #8ea4c7; font-weight: 500;';

    const dd = document.createElement('dd');
    dd.style.cssText = 'margin: 0; white-space: pre-line; color: #fefefe;';
    dd.textContent = value ?? '—';

    listEl.appendChild(dt);
    listEl.appendChild(dd);
  }

  function addList(label, items) {
    if (!listEl) return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    dt.style.cssText = 'color: #8ea4c7; font-weight: 500;';

    const dd = document.createElement('dd');
    dd.style.cssText = 'margin: 0;';
    const ul = document.createElement('ul');
    ul.style.cssText = 'padding-left: 16px; margin: 0; color: #fefefe;';
    items.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    dd.appendChild(ul);

    listEl.appendChild(dt);
    listEl.appendChild(dd);
  }

  function formatSpeed(speed) {
    return Number.isFinite(speed) ? `${speed.toFixed(2)} m/s` : 'n/a';
  }

  function formatLatLon(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'n/a';
    return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
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
    window.removeEventListener('wind:select', handleWindSelect);
    if (container?.parentElement) {
      container.parentElement.removeChild(container);
    }
    container = null;
    headerValueEl = null;
    listEl = null;
    messageEl = null;
  }

  return {
    group: null, // DOM-only component; nothing to attach to the Three.js scene.
    init,
    update() {},
    dispose,
  };
}
