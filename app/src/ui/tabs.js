import { byId } from './dom.js';

const TAB_IDS = ['data', 'train', 'recognize'];

export function initTabs() {
  const tabs = TAB_IDS.map((id) => byId(`tab-${id}`));
  const panels = TAB_IDS.map((id) => byId(`panel-${id}`));

  function select(id, { focus = false } = {}) {
    const active = TAB_IDS.indexOf(id);
    tabs.forEach((tab, index) => {
      const selected = index === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[index].hidden = !selected;
    });
    if (focus) tabs[active].focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(TAB_IDS[index]));
    tab.addEventListener('keydown', (event) => {
      const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TAB_IDS.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      select(TAB_IDS[(moves[event.key] + TAB_IDS.length) % TAB_IDS.length], { focus: true });
    });
  });

  return {
    select,
    setDone(id, done) {
      byId(`tab-${id}`).dataset.done = String(done);
    },
  };
}
