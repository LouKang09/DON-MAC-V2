// Coffee POS v1.5.2 safe loader: core/login first, enhancements only after authentication.
(() => {
  'use strict';
  const VERSION = '1.5.2-safe1';
  let enhancementsStarted = false;

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${src}${src.includes('?') ? '&' : '?'}v=${encodeURIComponent(VERSION)}`;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(s);
  });

  const isVisible = el => !!el && !el.classList.contains('hidden');

  function showRecoveryLogin(message) {
    const auth = document.getElementById('authScreen');
    const app = document.getElementById('app');
    app?.classList.add('hidden');
    auth?.classList.remove('hidden');
    const title = document.getElementById('authTitle');
    const hint = document.getElementById('authHint');
    const submit = document.getElementById('authSubmit');
    if (title) title.textContent = 'Sign in';
    if (hint) hint.textContent = message || 'Use your web POS account.';
    if (submit) submit.textContent = 'Sign in';
  }

  function loadFeatureCss() {
    if (document.getElementById('v15SafeCss')) return;
    const css = document.createElement('link');
    css.id = 'v15SafeCss';
    css.rel = 'stylesheet';
    css.href = `/v15.css?v=${encodeURIComponent(VERSION)}`;
    document.head.appendChild(css);
  }

  async function startEnhancementsWhenAppIsReady() {
    if (enhancementsStarted) return;
    const app = document.getElementById('app');
    if (!isVisible(app)) return;
    enhancementsStarted = true;
    try {
      loadFeatureCss();
      await loadScript('/live-refresh.js');
      await loadScript('/v15-safe.js');
      console.info('Coffee POS v1.5.2 safe enhancement layer started.');
    } catch (err) {
      // Never sacrifice the working core POS because an enhancement failed.
      console.error('Coffee POS enhancement startup:', err);
    }
  }

  function watchForAuthenticatedApp() {
    const app = document.getElementById('app');
    if (!app) return;
    const observer = new MutationObserver(() => {
      if (isVisible(app)) {
        startEnhancementsWhenAppIsReady();
        observer.disconnect();
      }
    });
    observer.observe(app, { attributes:true, attributeFilter:['class'] });
    startEnhancementsWhenAppIsReady();
  }

  // Authentication and the proven POS core always load first.
  loadScript('/ui-utils.js')
    .then(() => loadScript('/app-core.js'))
    .then(() => {
      watchForAuthenticatedApp();
      setTimeout(() => {
        const auth = document.getElementById('authScreen');
        const app = document.getElementById('app');
        if (!isVisible(auth) && !isVisible(app)) {
          showRecoveryLogin('The POS recovered from an incomplete browser startup. Please sign in.');
        }
      }, 5000);
    })
    .catch(err => {
      console.error('Coffee POS core startup:', err);
      showRecoveryLogin('A browser component failed to start. Please refresh once and sign in again.');
    });
})();
