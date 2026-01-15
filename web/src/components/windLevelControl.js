// web/src/components/windLevelControl.js
// DOM overlay kontrola za izbiro vetrnega nivoja (multi-level exploration)

export function createWindLevelControl({ options = {} }) {
  const position = options.position ?? 'bottom-left';
  const title = options.title ?? 'Level';
  const visible = options.visible ?? true;

  //these are mutable via setBounds() after init
  let min = Number.isFinite(options.min) ? options.min : 0;
  let max = Number.isFinite(options.max) ? options.max : 50;
  let step = Number.isFinite(options.step) ? options.step : 1;
  let initial = Number.isFinite(options.initial) ? options.initial : min;

  const formatLabel =
    typeof options.formatLabel === 'function'
      ? options.formatLabel
      : (v) => `Level ${v}`;

  const onLevelChange = typeof options.onLevelChange === 'function' ? options.onLevelChange : null;

  let container = null;
  let valueEl = null;
  let inputEl = null;
  let statusEl = null;
  let fillEl = null;

  function getPositionStyles(pos) {
    switch (pos) {
      case 'top-left':
        return 'top: 20px; left: 20px;';
      case 'top-right':
        return 'top: 20px; right: 20px;';
      case 'bottom-right':
        return 'bottom: 20px; right: 20px;';
      case 'bottom-left':
      default:
        return 'bottom: 20px; left: 20px;';
    }
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text ?? '';
  }

  function updateFill(value) {
    if (!fillEl) return;
    const range = max - min || 1;
    const pct = ((Number(value) - min) / range) * 100;
    const clamped = Math.max(0, Math.min(100, pct));
    fillEl.style.width = `${clamped}%`;
  }

  function setValue(v, { emit = false } = {}) {
    const clamped = Math.max(min, Math.min(max, Number(v)));
    if (inputEl) inputEl.value = String(clamped);
    if (valueEl) valueEl.textContent = formatLabel(clamped);
    updateFill(clamped);

    if (emit && onLevelChange) onLevelChange(clamped);
  }

  function setBounds({ nextMin, nextMax, nextStep } = {}) {
    if (Number.isFinite(nextMin)) min = nextMin;
    if (Number.isFinite(nextMax)) max = nextMax;
    if (Number.isFinite(nextStep)) step = nextStep;

    if (inputEl) {
      inputEl.min = String(min);
      inputEl.max = String(max);
      inputEl.step = String(step);

      // Keep current value valid
      const current = Number(inputEl.value);
      const clamped = Math.max(min, Math.min(max, current));
      inputEl.value = String(clamped);
      if (valueEl) valueEl.textContent = formatLabel(clamped);
      updateFill(clamped);
    }
  }

  function setDisabled(disabled) {
    if (inputEl) inputEl.disabled = !!disabled;
    if (container) container.style.opacity = disabled ? '0.7' : '1.0';
  }

  function init() {
    container = document.createElement('div');
    container.id = 'wind-level-control';
    container.style.cssText = `
      position: fixed;
      ${getPositionStyles(position)}
      background: linear-gradient(155deg, rgba(12, 18, 34, 0.96), rgba(5, 9, 18, 0.94));
      border: 1px solid rgba(140, 180, 255, 0.22);
      border-radius: 12px;
      padding: 14px 16px;
      font-family: "Avenir Next", "Avenir", "Futura", "Gill Sans", "Trebuchet MS", "Helvetica Neue", sans-serif;
      font-size: 12.5px;
      color: #eaf0ff;
      backdrop-filter: blur(14px) saturate(1.2);
      z-index: 1000;
      min-width: 220px;
      display: ${visible ? 'block' : 'none'};
      box-shadow: 0 18px 30px rgba(2, 6, 15, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      letter-spacing: 0.01em;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
    `;

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #9cc1ff;
    `;
    header.appendChild(titleEl);

    valueEl = document.createElement('div');
    valueEl.style.cssText = `
      font-variant-numeric: tabular-nums;
      color: #f8fbff;
      font-weight: 600;
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(110, 150, 255, 0.18);
      border: 1px solid rgba(140, 180, 255, 0.35);
    `;
    header.appendChild(valueEl);

    container.appendChild(header);

    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = `
      position: relative;
      height: 26px;
      display: flex;
      align-items: center;
      margin-top: 2px;
    `;

    const trackEl = document.createElement('div');
    trackEl.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      height: 6px;
      border-radius: 999px;
      background: rgba(120, 140, 180, 0.22);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);
    `;

    fillEl = document.createElement('div');
    fillEl.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, #7bd5ff, #6ef2c0);
      box-shadow: 0 0 10px rgba(110,242,192,0.35);
    `;
    trackEl.appendChild(fillEl);
    sliderWrap.appendChild(trackEl);

    inputEl = document.createElement('input');
    inputEl.type = 'range';
    inputEl.min = String(min);
    inputEl.max = String(max);
    inputEl.step = String(step);
    inputEl.value = String(initial);
    inputEl.style.cssText = `
      position: relative;
      width: 100%;
      margin: 0;
      background: transparent;
      accent-color: #7bd5ff;
      z-index: 1;
      height: 18px;
    `;

    inputEl.addEventListener('input', () => {
      const v = Number(inputEl.value);
      if (valueEl) valueEl.textContent = formatLabel(v);
      updateFill(v);
    });

    // Change fires less often; good place to load heavy data
    inputEl.addEventListener('change', () => {
      const v = Number(inputEl.value);
      if (valueEl) valueEl.textContent = formatLabel(v);
      updateFill(v);
      if (onLevelChange) onLevelChange(v);
    });

    sliderWrap.appendChild(inputEl);
    container.appendChild(sliderWrap);

    statusEl = document.createElement('div');
    statusEl.style.cssText = `
      margin-top: 8px;
      font-size: 11px;
      color: #8aa0c8;
      min-height: 14px;
      letter-spacing: 0.02em;
    `;
    container.appendChild(statusEl);

    document.body.appendChild(container);

    setValue(initial, { emit: false });
    setStatus('');
  }

  function dispose() {
    if (container && container.parentElement) container.parentElement.removeChild(container);
    container = null;
    valueEl = null;
    inputEl = null;
    statusEl = null;
    fillEl = null;
  }

  function show() {
    if (container) container.style.display = 'block';
  }

  function hide() {
    if (container) container.style.display = 'none';
  }

  return {
    group: null,
    init,
    update() {},
    dispose,
    show,
    hide,
    setValue,
    setBounds,
    setDisabled,
    setStatus,
  };
}
