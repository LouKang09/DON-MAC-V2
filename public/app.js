// Coffee POS v1.5.7 safe loader: core/login first, enhancements only after authentication.
(() => {
  'use strict';
  const VERSION = '1.5.25-branch-group-messaging';
  let enhancementsStarted = false;

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${src}${src.includes('?') ? '&' : '?'}v=${encodeURIComponent(VERSION)}`;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(s);
  });

  const loadCss = (id, src) => {
    if (document.getElementById(id)) return;
    const css = document.createElement('link');
    css.id = id;
    css.rel = 'stylesheet';
    css.href = `${src}?v=${encodeURIComponent(VERSION)}`;
    document.head.appendChild(css);
  };

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
      loadCss('v15SafeCss', '/v15.css');
      loadCss('v153Css', '/v153.css');
      loadCss('v154Css', '/v154.css');
      loadCss('v155Css', '/v155.css');
      loadCss('v156Css', '/v156.css');
      loadCss('posRefreshCss', '/pos-refresh.css');
      loadCss('sidebarNavCss', '/sidebar-v1511.css');
      loadCss('dashboardEnhancementsCss', '/dashboard-v1512.css');
      loadCss('dashboardRefinementCss', '/dashboard-v1513.css');
      loadCss('logoAndReportCss', '/logo-report-v1514.css');
      loadCss('posStaticIconsCss', '/pos-category-icons-v1520.css');
      loadCss('posCategoryAdminCss', '/pos-categories-admin.css');
      loadCss('chatCss', '/internal-chat.css');
      loadCss('floatingChatSidebarCss', '/sidebar-chat-floating-v1523.css');


      await loadScript('/live-refresh.js');
      await loadScript('/v15-safe.js');
      await loadScript('/v153-features.js');
      await loadScript('/v154-tuning.js');
      await loadScript('/v155-features.js');
      await loadScript('/v156-features.js');
      await loadScript('/pos-refresh.js');
      await loadScript('/dashboard-v1512.js');
      await loadScript('/pos-categories-admin.js');
      await loadScript('/internal-chat.js');
      window.donmacChat?.loggedIn(window.donmacChatUserId||null);



      console.info('Don Macchiatos POS v1.5.25 enhancement layers started.');
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
