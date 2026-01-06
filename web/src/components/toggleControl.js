// web/src/components/toggleControl.js
// Small reusable DOM toggle (checkbox) overlay.

export function createToggleControl({ options = {} }) {
  const position = options.position ?? 'top-left';
  const title = options.title ?? 'Toggle';
  const visible = options.visible ?? true;
  const initial = options.initial ?? true;
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;

  let container = null;
  let inputEl = null;
  let statusEl = null;

  function getPositionStyles(pos) {
    switch (pos) {
      case 'top-right':
        return 'top: 20px; right: 20px;';
      case 'bottom-left':
        return 'bottom: 20px; left: 20px;';
      case 'bottom-right':
        return 'bottom: 20px; right: 20px;';
      case 'top-left':
      default:
        return 'top: 20px; left: 20px;';
    }
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text ?? '';
  }

  function setChecked(checked, { emit = false } = {}) {
    if (inputEl) inputEl.checked = !!checked;
    if (emit && onChange) onChange(!!checked);
  }

  function setDisabled(disabled) {
    if (inputEl) inputEl.disabled = !!disabled;
    if (container) container.style.opacity = disabled ? '0.7' : '1.0';
  }

  function init() {
    container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      ${getPositionStyles(position)}
      background: rgba(5, 7, 13, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      padding: 10px 12px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: #ffffff;
      backdrop-filter: blur(10px);
      z-index: 1000;
      min-width: 220px;
      display: ${visible ? 'block' : 'none'};
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    const row = document.createElement('label');
    row.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
      user-select: none;
    `;

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      font-weight: 600;
      color: #e0e0e0;
    `;

    inputEl = document.createElement('input');
    inputEl.type = 'checkbox';
    inputEl.checked = !!initial;
    inputEl.style.cssText = `
      width: 18px;
      height: 18px;
      accent-color: #4a90e2;
    `;

    inputEl.addEventListener('change', () => {
      if (onChange) onChange(!!inputEl.checked);
    });

    row.appendChild(titleEl);
    row.appendChild(inputEl);
    container.appendChild(row);

    statusEl = document.createElement('div');
    statusEl.style.cssText = `
      margin-top: 6px;
      font-size: 11px;
      color: #888;
      min-height: 14px;
    `;
    container.appendChild(statusEl);

    document.body.appendChild(container);
    setStatus('');
  }

  function dispose() {
    if (container && container.parentElement) container.parentElement.removeChild(container);
    container = null;
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
    setChecked,
    setDisabled,
    setStatus,
  };
}

