import { byId, element } from './dom.js';

const DURATION_MS = { info: 3500, success: 3500, warn: 6000, error: 8000 };
const MAX_VISIBLE = 3;

export function createToaster() {
  const root = byId('toasts');
  return function toast(level, message) {
    const node = element('div', { className: 'toast', text: message, attrs: { 'data-level': level } });
    root.append(node);
    while (root.children.length > MAX_VISIBLE) root.firstElementChild.remove();
    setTimeout(() => node.remove(), DURATION_MS[level] ?? 4000);
  };
}
