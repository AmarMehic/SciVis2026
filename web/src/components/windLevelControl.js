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

  function setValue(v, { emit = false } = {}) {
    const clamped = Math.max(min, Math.min(max, Number(v)));
    if (inputEl) inputEl.value = String(clamped);
    if (valueEl) valueEl.textContent = formatLabel(clamped);

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
      background: rgba(5, 7, 13, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      padding: 12px 16px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: #ffffff;
      backdrop-filter: blur(10px);
      z-index: 1000;
      min-width: 220px;
      display: ${visible ? 'block' : 'none'};
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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
      font-size: 14px;
      color: #e0e0e0;
    `;
    header.appendChild(titleEl);

    valueEl = document.createElement('div');
    valueEl.style.cssText = `
      font-variant-numeric: tabular-nums;
      color: #ffffff;
      font-weight: 600;
    `;
    header.appendChild(valueEl);

    container.appendChild(header);

    inputEl = document.createElement('input');
    inputEl.type = 'range';
    inputEl.min = String(min);
    inputEl.max = String(max);
    inputEl.step = String(step);
    inputEl.value = String(initial);
    inputEl.style.cssText = `
      width: 100%;
      accent-color: #4a90e2;
    `;

    inputEl.addEventListener('input', () => {
      const v = Number(inputEl.value);
      if (valueEl) valueEl.textContent = formatLabel(v);
    });

    // Change fires less often; good place to load heavy data
    inputEl.addEventListener('change', () => {
      const v = Number(inputEl.value);
      if (valueEl) valueEl.textContent = formatLabel(v);
      if (onLevelChange) onLevelChange(v);
    });

    container.appendChild(inputEl);

    statusEl = document.createElement('div');
    statusEl.style.cssText = `
      margin-top: 8px;
      font-size: 11px;
      color: #888;
      min-height: 14px;
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
