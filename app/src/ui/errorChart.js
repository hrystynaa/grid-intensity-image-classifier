import { niceTicks } from '../core/chartScale.js';
import { formatMetric, formatNumber, formatPercent } from '../core/format.js';
import { element } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_POINTS = 600;
const HEIGHT = 240;
const MIN_WIDTH = 260;
const MARGIN = { top: 14, right: 58, bottom: 30, left: 50 };

function svgNode(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createErrorChart({ container, empty }) {
  const svg = svgNode('svg', { role: 'img', tabindex: '0', 'aria-label': 'Графік помилки за епохами' });
  const tooltip = element('div', { className: 'chart-tooltip', attrs: { hidden: '' } });
  const plot = element('div', { className: 'chart-plot' }, [svg, tooltip]);
  const tableBody = element('tbody');
  const table = element('table', { className: 'data-table' }, [
    element('caption', { className: 'visually-hidden', text: 'Значення помилки за епохами' }),
    element('thead', {}, [
      element('tr', {}, ['Епоха', 'Помилка', 'Точність на перевірці'].map((text) => element('th', { text, attrs: { scope: 'col' } }))),
    ]),
    tableBody,
  ]);
  const details = element('details', { className: 'chart-table' }, [
    element('summary', { text: 'Показати значення таблицею' }),
    element('div', { className: 'table-wrap chart-table-scroll' }, [table]),
  ]);
  container.append(plot, details);

  let points = [];
  let domain = 1;
  let active = null;
  let frame = null;
  let scale = null;

  function renderTable() {
    if (!details.open) return;
    tableBody.replaceChildren(
      ...points.map((point) =>
        element('tr', {}, [
          element('td', { text: formatNumber(point.epoch) }),
          element('td', { text: formatMetric(point.error) }),
          element('td', { text: formatPercent(point.validationAccuracy ?? NaN) }),
        ]),
      ),
    );
  }

  function renderTooltip() {
    const point = points[active];
    if (!point || !scale) {
      tooltip.hidden = true;
      return;
    }
    const rows = [
      element('strong', { text: formatMetric(point.error) }),
      element('span', { text: `Епоха ${formatNumber(point.epoch)}` }),
    ];
    if (Number.isFinite(point.validationAccuracy)) {
      rows.push(element('span', { text: `Точність на перевірці ${formatPercent(point.validationAccuracy)}` }));
    }
    tooltip.replaceChildren(...rows);
    tooltip.hidden = false;
    const x = scale.x(point.epoch);
    const room = plot.clientWidth - tooltip.offsetWidth - 8;
    tooltip.style.left = `${Math.max(0, Math.min(room, x + 10 > room ? x - tooltip.offsetWidth - 10 : x + 10))}px`;
  }

  function render() {
    frame = null;
    if (!points.length) return;
    const width = Math.max(MIN_WIDTH, plot.clientWidth);
    const innerWidth = width - MARGIN.left - MARGIN.right;
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const yTicks = niceTicks(points.reduce((max, point) => Math.max(max, point.error), 0));
    const yTop = yTicks.at(-1);
    const xTicks = niceTicks(domain).filter((tick) => tick <= domain);
    const x = (epoch) => MARGIN.left + (epoch / domain) * innerWidth;
    const y = (value) => MARGIN.top + (1 - value / yTop) * innerHeight;
    scale = { x, y };

    svg.setAttribute('width', width);
    svg.setAttribute('height', HEIGHT);
    svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);

    const nodes = [];
    for (const tick of yTicks) {
      nodes.push(svgNode('line', { class: 'chart-grid', x1: MARGIN.left, x2: width - MARGIN.right, y1: y(tick), y2: y(tick) }));
      nodes.push(svgNode('text', { class: 'chart-axis-text', x: MARGIN.left - 7, y: y(tick) + 4, 'text-anchor': 'end' }, formatMetric(tick)));
    }
    for (const tick of xTicks) {
      nodes.push(svgNode('text', { class: 'chart-axis-text', x: x(tick), y: HEIGHT - 9, 'text-anchor': 'middle' }, formatNumber(tick)));
    }

    const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.epoch).toFixed(1)} ${y(point.error).toFixed(1)}`).join('');
    nodes.push(svgNode('path', { class: 'chart-line', d: path }));

    const last = points.at(-1);
    nodes.push(svgNode('circle', { class: 'chart-dot', cx: x(last.epoch), cy: y(last.error), r: 4 }));
    nodes.push(svgNode('text', { class: 'chart-end-text', x: x(last.epoch) + 8, y: y(last.error) + 4 }, formatMetric(last.error)));

    const point = points[active];
    if (point) {
      nodes.push(svgNode('line', { class: 'chart-cross', x1: x(point.epoch), x2: x(point.epoch), y1: MARGIN.top, y2: MARGIN.top + innerHeight }));
      nodes.push(svgNode('circle', { class: 'chart-dot', cx: x(point.epoch), cy: y(point.error), r: 4 }));
    }
    svg.replaceChildren(...nodes);
    svg.setAttribute('aria-label', `Графік помилки: епоха ${formatNumber(last.epoch)} із ${formatNumber(domain)}, помилка ${formatMetric(last.error)}`);
    renderTooltip();
  }

  const schedule = () => {
    frame ??= requestAnimationFrame(render);
  };

  function setActive(index) {
    active = index;
    if (frame === null) render();
  }

  svg.addEventListener('pointermove', (event) => {
    if (!points.length || !scale) return;
    const left = svg.getBoundingClientRect().left;
    const epoch = ((event.clientX - left - MARGIN.left) / (svg.clientWidth - MARGIN.left - MARGIN.right)) * domain;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.epoch - epoch) < Math.abs(points[nearest].epoch - epoch)) nearest = index;
    });
    setActive(nearest);
  });
  svg.addEventListener('pointerleave', () => setActive(null));
  svg.addEventListener('blur', () => setActive(null));
  svg.addEventListener('keydown', (event) => {
    if (!points.length) return;
    const last = points.length - 1;
    const current = active ?? last;
    const moves = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(last, moves[event.key])));
  });
  details.addEventListener('toggle', renderTable);
  new ResizeObserver(schedule).observe(plot);

  function show(hasData) {
    empty.hidden = hasData;
    container.hidden = !hasData;
  }

  show(false);

  return {
    start(totalEpochs) {
      points = [];
      domain = totalEpochs;
      active = null;
      svg.replaceChildren();
      tooltip.hidden = true;
      show(false);
    },
    add(epoch, error) {
      if (points.length >= MAX_POINTS) points = points.filter((_, index) => index % 2 === 0);
      points.push({ epoch, error });
      show(true);
      schedule();
    },
    setHistory(history, totalEpochs) {
      points = history.filter((point) => Number.isFinite(point.error));
      domain = totalEpochs;
      active = null;
      show(points.length > 0);
      schedule();
      renderTable();
    },
  };
}
