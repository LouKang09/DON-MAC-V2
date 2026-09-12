// Coffee POS v1.5.6 — tablet/mobile UX enhancements.
// Targeted only: no document-wide observers.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  const CURRENT_NOTES = [
    'Tablet POS now keeps a compact desktop-style layout with a slim left navigation rail, product catalog, and current order visible side-by-side.',
    'Tablet controls, product cards, tables, forms, and dialogs are optimized for touch without making the interface feel like an oversized phone.',
    'Phone navigation now uses a compact bottom app bar with a floating Order shortcut for faster checkout.',
    'Portrait and landscape tablet layouts now adapt independently, including short landscape screens.',
    'Reports, Inventory, Catalog Admin, audit tables, and dialogs received tablet/mobile spacing and scrolling improvements.'
  ];

  function updateReleaseHistory() {
    const list = $('whatsNewList');
    if (list) list.innerHTML = CURRENT_NOTES.map(x => `<li>${esc(x)}</li>`).join('');
    const version = $('whatsNewVersion');
    if (version) version.textContent = 'v1.5.6';

    const history = document.querySelector('#versionHistorySection .version-history');
    if (history && !history.querySelector('[data-version="1.5.6"]')) {
      history.querySelectorAll('.version-entry.current').forEach(x => x.classList.remove('current'));
      const entry = document.createElement('details');
      entry.className = 'version-entry current';
      entry.open = true;
      entry.dataset.version = '1.5.6';
      entry.innerHTML = `<summary><span class="version-meta"><span class="version-chip">v1.5.6</span><span>Tablet-first POS experience</span></span></summary><ul>${CURRENT_NOTES.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
      history.prepend(entry);
    }

    const intro = document.querySelector('#versionHistorySection .version-history-intro');
    if (intro) intro.textContent = 'Track how the Coffee POS has progressed from the original Excel-to-Web migration through the current tablet-ready production build.';

    const upcoming = document.querySelector('.upcoming-copy');
    if (upcoming) upcoming.textContent = 'Upcoming: multi-branch inventory, branch dashboards, branch permissions, and controlled branch-to-branch transfer receiving.';
  }

  function ensureMobileOrderJump() {
    if ($('mobileOrderJump')) return;
    const button = document.createElement('button');
    button.id = 'mobileOrderJump';
    button.type = 'button';
    button.setAttribute('aria-label', 'Jump to current order');
    button.innerHTML = '<span>View Order</span><span class="mobile-order-count">0</span>';
    button.onclick = () => {
      document.querySelector('.order-panel')?.scrollIntoView({ behavior:'smooth', block:'start' });
    };
    document.body.appendChild(button);

    const orderList = $('orderList');
    if (!orderList) return;
    const count = button.querySelector('.mobile-order-count');
    const update = () => {
      const rows = orderList.querySelectorAll('.order-row').length;
      count.textContent = String(rows);
      button.classList.toggle('has-items', rows > 0);
      button.title = rows ? `${rows} order line${rows === 1 ? '' : 's'}` : 'Current order is empty';
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(orderList, { childList:true, subtree:false });
  }

  function addResponsiveHints() {
    // Make scrollable tab rows accessible by keyboard/touch assistive tools.
    document.querySelectorAll('.tabs,.sidebar nav,.table-wrap,.inventory-audit-scroll,.costing-scroll-panel').forEach(el => {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex','0');
    });
  }

  function init() {
    if (document.documentElement.dataset.v156Init === '1') return;
    document.documentElement.dataset.v156Init = '1';
    updateReleaseHistory();
    ensureMobileOrderJump();
    addResponsiveHints();
    console.info('Coffee POS v1.5.6 tablet/mobile enhancements initialized.');
  }

  init();
})();
