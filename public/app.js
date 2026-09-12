// Coffee POS v1.5.0 resilient loader: boot core first, then live sync/features.
(() => {
  const VERSION = '1.5.0-bootfix1';

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${src}${src.includes('?') ? '&' : '?'}v=${encodeURIComponent(VERSION)}`;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(s);
  });

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isVisible(el) {
    return !!el && !el.classList.contains('hidden');
  }

  async function waitForCoreUi() {
    // app-core starts boot() asynchronously. Do not let the live-sync and v1.5
    // feature layers race it while both main containers are still hidden.
    for (let i = 0; i < 50; i++) {
      const auth = document.getElementById('authScreen');
      const app = document.getElementById('app');
      if (isVisible(auth) || isVisible(app)) return;
      await sleep(100);
    }

    // Last-resort recovery: an empty beige page must never be left on screen.
    // Determine whether this browser still has a valid session and reveal the
    // appropriate shell. The normal app-core handlers remain responsible for
    // all login/POS behavior after this recovery.
    const auth = document.getElementById('authScreen');
    const app = document.getElementById('app');
    try {
      const response = await fetch(`/api/auth/me?_boot=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, max-age=0' }
      });
      if (response.ok) {
        auth?.classList.add('hidden');
        app?.classList.remove('hidden');
      } else {
        app?.classList.add('hidden');
        auth?.classList.remove('hidden');
        const title = document.getElementById('authTitle');
        const hint = document.getElementById('authHint');
        const submit = document.getElementById('authSubmit');
        if (title) title.textContent = 'Sign in';
        if (hint) hint.textContent = 'Use your web POS account.';
        if (submit) submit.textContent = 'Sign in';
      }
    } catch (err) {
      app?.classList.add('hidden');
      auth?.classList.remove('hidden');
      const hint = document.getElementById('authHint');
      if (hint) hint.textContent = 'The POS is online, but the browser could not finish startup. Refresh once or sign in again.';
      console.error('Coffee POS boot recovery:', err);
    }
  }

  // Keep the v1.5 stylesheet cache-busted as well.
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = `/v15.css?v=${encodeURIComponent(VERSION)}`;
  document.head.appendChild(css);

  loadScript('/ui-utils.js')
    .then(() => loadScript('/app-core.js'))
    .then(() => waitForCoreUi())
    .then(() => loadScript('/live-refresh.js'))
    .then(() => loadScript('/v15-features.js'))
    .catch(err => {
      console.error(err);
      // Even if an enhancement layer fails, keep the core login/POS visible.
      const auth = document.getElementById('authScreen');
      const app = document.getElementById('app');
      if (!isVisible(auth) && !isVisible(app)) {
        app?.classList.add('hidden');
        auth?.classList.remove('hidden');
        const hint = document.getElementById('authHint');
        if (hint) hint.textContent = 'A browser component failed to load. You can still sign in; refresh once after the connection stabilizes.';
      }
    });
})();
