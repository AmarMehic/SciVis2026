// web/src/components/windLegend.js
// Legend overlay za prikaz barvne lestvice hitrosti vetra

export function createWindLegend({ options = {} }) {
  const position = options.position ?? 'bottom-right';
  const title = options.title ?? 'Wind Speed';
  const visible = options.visible ?? true;

  // Barvne stopnje (usklajene z interactiveWind.js)
  const colorStops = [
    { speed: 0, label: 'Slow', color: '#4a90e2' },
    { speed: 0.25, label: '', color: '#50c878' },
    { speed: 0.5, label: 'Medium', color: '#ffeb3b' },
    { speed: 0.75, label: '', color: '#ff9800' },
    { speed: 1.0, label: 'Fast', color: '#f44336' },
  ];

  let container = null;

  function init() {
    // Ustvari DOM element za legendo
    container = document.createElement('div');
    container.id = 'wind-legend';
    container.style.cssText = `
      position: fixed;
      ${getPositionStyles(position)}
      background: linear-gradient(155deg, rgba(12, 18, 34, 0.96), rgba(5, 9, 18, 0.94));
      border: 1px solid rgba(140, 180, 255, 0.22);
      border-radius: 12px;
      padding: 12px 16px;
      font-family: "Avenir Next", "Avenir", "Futura", "Gill Sans", "Trebuchet MS", "Helvetica Neue", sans-serif;
      font-size: 12.5px;
      color: #eaf0ff;
      backdrop-filter: blur(14px) saturate(1.2);
      z-index: 1000;
      min-width: 180px;
      display: ${visible ? 'block' : 'none'};
      box-shadow: 0 18px 30px rgba(2, 6, 15, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      letter-spacing: 0.01em;
    `;

    // Naslov
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      font-weight: 600;
      margin-bottom: 10px;
      font-size: 12px;
      text-align: center;
      color: #9cc1ff;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    `;
    container.appendChild(titleEl);

    // Gradient bar
    const gradientBar = document.createElement('div');
    const gradientColors = colorStops.map(s => s.color).join(', ');
    gradientBar.style.cssText = `
      width: 100%;
      height: 14px;
      background: linear-gradient(to right, ${gradientColors});
      border-radius: 999px;
      margin-bottom: 10px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 0 10px rgba(123, 213, 255, 0.2);
    `;
    container.appendChild(gradientBar);

    // Labels
    const labelsContainer = document.createElement('div');
    labelsContainer.style.cssText = `
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #b5c1dc;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    `;

    colorStops.forEach((stop, idx) => {
      if (stop.label || idx === 0 || idx === colorStops.length - 1) {
        const label = document.createElement('span');
        label.textContent = stop.label || (idx === 0 ? 'Min' : 'Max');
        labelsContainer.appendChild(label);
      }
    });

    container.appendChild(labelsContainer);

    // Dodaj info text
    const infoEl = document.createElement('div');
    infoEl.style.cssText = `
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 11px;
      color: #8aa0c8;
      text-align: center;
      letter-spacing: 0.02em;
    `;
    infoEl.textContent = 'Click on wind vectors to see details';
    container.appendChild(infoEl);

    document.body.appendChild(container);
  }

  function getPositionStyles(pos) {
    switch (pos) {
      case 'top-left':
        return 'top: 20px; left: 20px;';
      case 'top-right':
        return 'top: 20px; right: 20px;';
      case 'bottom-left':
        return 'bottom: 20px; left: 20px;';
      case 'bottom-right':
      default:
        return 'bottom: 20px; right: 20px;';
    }
  }

  function show() {
    if (container) container.style.display = 'block';
  }

  function hide() {
    if (container) container.style.display = 'none';
  }

  function dispose() {
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
    container = null;
  }

  return {
    group: null, // Legend nima 3D objektov
    init,
    update() {},
    dispose,
    show,
    hide,
  };
}
