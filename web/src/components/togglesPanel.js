// web/src/components/togglesPanel.js
// A small overlay panel that can host multiple toggle rows in one shared box.
// Usage:
// addComponent('toolsPanel', createTogglesPanel, {
//   options: {
//     position: 'top-right',
//     items: [
//       { id: 'global', title: 'Global streamlines', initial: true, onChange: (v)=>{} },
//       { id: 'hitboxes', title: 'Interactive hitboxes', initial: false, onChange: (v)=>{} },
//     ]
//   }
// });

export function createTogglesPanel({ options = {} }) {
  const position = options.position ?? 'top-right';
  const visible = options.visible ?? true;
  const items = Array.isArray(options.items) ? options.items : [];

  let container = null;
  const inputs = new Map(); // id -> input element

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
      min-width: 240px;
      display: ${visible ? 'block' : 'none'};
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    items.forEach((item, idx) => {
      const row = document.createElement('label');
      row.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
        user-select: none;
        ${idx > 0 ? 'margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.12);' : ''}
      `;

      const titleEl = document.createElement('div');
      titleEl.textContent = item.title ?? item.id ?? 'Toggle';
      titleEl.style.cssText = `
        font-weight: 600;
        color: #e0e0e0;
      `;

      const inputEl = document.createElement('input');
      inputEl.type = 'checkbox';
      inputEl.checked = !!item.initial;
      inputEl.style.cssText = `
        width: 18px;
        height: 18px;
        accent-color: #4a90e2;
      `;

      if (typeof item.onChange === 'function') {
        inputEl.addEventListener('change', () => item.onChange(!!inputEl.checked));
      }

      row.appendChild(titleEl);
      row.appendChild(inputEl);
      container.appendChild(row);

      if (item.id) inputs.set(item.id, inputEl);
    });

    document.body.appendChild(container);
  }

  function dispose() {
    if (container && container.parentElement) container.parentElement.removeChild(container);
    inputs.clear();
    container = null;
  }

  function setChecked(id, checked, { emit = false } = {}) {
    const el = inputs.get(id);
    if (!el) return;
    el.checked = !!checked;
    if (emit) el.dispatchEvent(new Event('change'));
  }

  function setDisabled(id, disabled) {
    const el = inputs.get(id);
    if (el) el.disabled = !!disabled;
  }

  function show() { if (container) container.style.display = 'block'; }
  function hide() { if (container) container.style.display = 'none'; }

  return { group: null, init, update() {}, dispose, setChecked, setDisabled, show, hide };
}

