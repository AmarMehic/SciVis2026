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
  const switches = new Map(); // id -> { track, thumb, row }

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

  function applySwitchVisual(switchParts, checked, disabled) {
    if (!switchParts) return;
    const { track, thumb, row } = switchParts;
    const onBg = 'linear-gradient(120deg, rgba(123,213,255,0.95), rgba(110,242,192,0.95))';
    const offBg = 'rgba(120,135,170,0.35)';
    track.style.background = checked ? onBg : offBg;
    track.style.boxShadow = checked
      ? '0 0 12px rgba(110,242,192,0.35)'
      : 'inset 0 0 0 1px rgba(255,255,255,0.18)';
    thumb.style.transform = checked ? 'translateX(20px)' : 'translateX(0px)';
    thumb.style.background = checked ? '#0b1622' : '#f7f9ff';
    thumb.style.border = checked
      ? '1px solid rgba(255,255,255,0.55)'
      : '1px solid rgba(255,255,255,0.25)';
    const opacity = disabled ? '0.5' : '1';
    track.style.opacity = opacity;
    thumb.style.opacity = opacity;
    if (row) row.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }

  function init() {
    container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      ${getPositionStyles(position)}
      background: linear-gradient(155deg, rgba(12, 18, 34, 0.96), rgba(5, 9, 18, 0.94));
      border: 1px solid rgba(140, 180, 255, 0.22);
      border-radius: 12px;
      padding: 12px 14px;
      font-family: "Avenir Next", "Avenir", "Futura", "Gill Sans", "Trebuchet MS", "Helvetica Neue", sans-serif;
      font-size: 12.5px;
      color: #eaf0ff;
      backdrop-filter: blur(14px) saturate(1.2);
      z-index: 1000;
      min-width: 240px;
      display: ${visible ? 'block' : 'none'};
      box-shadow: 0 18px 30px rgba(2, 6, 15, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      letter-spacing: 0.01em;
    `;

    items.forEach((item, idx) => {
      const row = document.createElement('label');
      row.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 8px 8px;
        border-radius: 10px;
        background: rgba(8, 12, 22, 0.55);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
        cursor: pointer;
        user-select: none;
        ${idx > 0 ? 'margin-top: 8px;' : ''}
      `;

      const titleEl = document.createElement('div');
      titleEl.textContent = item.title ?? item.id ?? 'Toggle';
      titleEl.style.cssText = `
        font-weight: 600;
        color: #eaf0ff;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-size: 11px;
      `;

      const inputEl = document.createElement('input');
      inputEl.type = 'checkbox';
      inputEl.checked = !!item.initial;
      inputEl.style.cssText = `
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
      `;

      const switchTrack = document.createElement('div');
      switchTrack.style.cssText = `
        position: relative;
        width: 42px;
        height: 22px;
        border-radius: 999px;
        background: rgba(120,135,170,0.35);
        transition: background 0.2s ease, box-shadow 0.2s ease;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
      `;

      const switchThumb = document.createElement('div');
      switchThumb.style.cssText = `
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #f7f9ff;
        transition: transform 0.2s ease, background 0.2s ease, border 0.2s ease;
        box-shadow: 0 4px 10px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.25);
      `;
      switchTrack.appendChild(switchThumb);

      const switchParts = { track: switchTrack, thumb: switchThumb, row };
      applySwitchVisual(switchParts, inputEl.checked, inputEl.disabled);

      inputEl.addEventListener('change', () => {
        applySwitchVisual(switchParts, inputEl.checked, inputEl.disabled);
        if (typeof item.onChange === 'function') item.onChange(!!inputEl.checked);
      });

      row.appendChild(titleEl);
      row.appendChild(inputEl);
      row.appendChild(switchTrack);
      container.appendChild(row);

      if (item.id) {
        inputs.set(item.id, inputEl);
        switches.set(item.id, switchParts);
      }
    });

    document.body.appendChild(container);
  }

  function dispose() {
    if (container && container.parentElement) container.parentElement.removeChild(container);
    inputs.clear();
    switches.clear();
    container = null;
  }

  function setChecked(id, checked, { emit = false } = {}) {
    const el = inputs.get(id);
    if (!el) return;
    el.checked = !!checked;
    applySwitchVisual(switches.get(id), el.checked, el.disabled);
    if (emit) el.dispatchEvent(new Event('change'));
  }

  function setDisabled(id, disabled) {
    const el = inputs.get(id);
    if (!el) return;
    el.disabled = !!disabled;
    applySwitchVisual(switches.get(id), el.checked, el.disabled);
  }

  function show() { if (container) container.style.display = 'block'; }
  function hide() { if (container) container.style.display = 'none'; }

  return { group: null, init, update() {}, dispose, setChecked, setDisabled, show, hide };
}
