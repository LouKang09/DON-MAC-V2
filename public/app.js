// Coffee POS v1.5.1 safe loader: keep authentication/core usable first.
(() => {
  const VERSION = '1.5.1-login-hotfix';
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

  async function startEnhancementsWhenAppIsReady() {
    if (enhancementsStarted) return;
    const app = document.getElementById('app');
    if (!isVisible(app)) return;
    enhancementsStarted = true;
    try {
      // Live sync is safe to start only after the authenticated POS is visible.
      await loadScript('/live-refresh.js');
      // v1.5 feature layer is temporarily disabled by this hotfix because its
      // document-wide observer can freeze some Chromium/Brave sessions.
      // Core POS, sales, reports, inventory, PostgreSQL and live sync remain available.
      console.info('Coffee POS safe mode: v1.5 feature layer deferred for browser stability.');
    } catch (err) {
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
    observer.observe(app, { attributes: true, attributeFilter: ['class'] });
    startEnhancementsWhenAppIsReady();
  }

  // Load only the stable core during authentication.
  loadScript('/ui-utils.js')
    .then(() => loadScript('/app-core.js'))
    .then(() => {
      watchForAuthenticatedApp();
      // Recovery guard: if core startup somehow leaves both shells hidden,
      // reveal login without running any enhancement code.
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
