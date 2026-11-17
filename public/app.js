// Coffee POS v1.5.7 safe loader: core/login first, enhancements only after authentication.
(() => {
  'use strict';
  const VERSION = '1.6.22-receipt-columns-20261117';
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
    css.href = `${src}${src.includes('?') ? '&' : '?'}v=${encodeURIComponent(VERSION)}`;
    document.head.appendChild(css);
  };

  // Presentation is identical for SHARED and NEW franchises. Never condition
  // visual CSS on account data mode; only network features remain isolated.
  function loadSharedPresentationStyles(){
      loadCss('v15SafeCss', '/v15.css');
      loadCss('v153Css', '/v153.css');
      loadCss('v154Css', '/v154.css');
      loadCss('v155Css', '/v155.css');
      loadCss('v156Css', '/v156.css');
      loadCss('posRefreshCss', '/pos-refresh.css');
      loadCss('dmUnifiedRefreshV20261107', '/refresh-controls-v20261107.css');
      loadCss('sidebarNavCss', '/sidebar-v1511.css');
      loadCss('dashboardEnhancementsCss', '/dashboard-v1512.css');
      loadCss('dashboardRefinementCss', '/dashboard-v1513.css');
      loadCss('premiumDashboardPreviewCss', '/premium-dashboard-preview-v1532.css');
      loadCss('premiumDashboardFeatureGalleryCss', '/premium-dashboard-feature-gallery-v1533.css');
      loadCss('referenceDashboardPreviewCss', '/reference-dashboard-preview-v1535.css');
      loadCss('logoAndReportCss', '/logo-report-v1514.css');
      loadCss('posStaticIconsCss', '/pos-category-icons-v1520.css');
      loadCss('posCategoryAdminCss', '/pos-categories-admin.css');
      loadCss('chatCss', '/internal-chat.css');
      loadCss('floatingChatSidebarCss', '/sidebar-chat-floating-v1523.css');
      loadCss('chatResponsiveV1527Css', '/sidebar-chat-responsive-v1527.css');
      // Mobile navigation CSS is now linked in index.html before first paint.
      loadCss('inventoryRedesignV1536Css', '/inventory-redesign-v1536.css');
      loadCss('inventoryCardsV1537Css', '/inventory-cards-v1537.css');
      loadCss('inventoryBatchV1538Css', '/inventory-batch-editor-v1538.css');
      loadCss('inventoryAuditV1540Css', '/inventory-audit-v1540.css');
      loadCss('salesReportV1541Css', '/sales-report-v1541.css');
      loadCss('ownerSalesV1542Css', '/owner-sales-v1542.css');
      loadCss('devPlansV1543Css', '/dev-plans-v1543.css');
      loadCss('posCatalogV1544Css', '/pos-catalog-v1544.css');
      loadCss('catalogIconsPackagesV1545Css', '/catalog-icons-packages-v1545.css');
      loadCss('posCatalogTilesV1546Css', '/pos-catalog-tiles-v1546.css');
      loadCss('topbarGreenV1549Css', '/topbar-green-v1549.css');
      loadCss('auditLogsCompactV1552Css', '/audit-logs-compact-v1552.css');
      loadCss('archiveCompareV1553Css', '/archive-compare-v1553.css');
      loadCss('supplyFranchiseV1554Css','/supply-franchise.css');
      loadCss('posFinanceV20261107','/pos-finance.css');
      loadCss('topbarResponsiveV1554Css','/topbar-responsive-v1554.css');
      loadCss('posCompactCheckoutV1556Css','/pos-compact-checkout-v1556.css');
      loadCss('sidebarResponsiveV1557Css','/sidebar-responsive-v1557.css');
      loadCss('subscriptionPaginationV1557Css','/subscription-pagination-v1557.css');
      loadCss('posVisualPolishV1558Css','/pos-visual-polish-v1558.css');
      loadCss('posPaymentViewportV1559Css','/pos-payment-viewport-v1559.css');
      loadCss('posIconsHoverV1562Css','/pos-icons-hover-v1562.css');
      loadCss('posIconCropV1563Css','/pos-icon-crop-v1563.css');
      loadCss('usersManagementRefinementV1569','/users-management-refinement-v1569.css');
      loadCss('planDashboardV1570','/plan-dashboard-v1570.css');
      loadCss('dashboardCompactV1571','/dashboard-compact-v1571.css');
      loadCss('dashboardExperienceV1573','/dashboard-experience-v1573.css');
      loadCss('csvSalesImportV1572','/sales-csv-import-v1572.css');
      loadCss('dmUiRefinements20261107','/ui-refinements-v20261107.css');
      loadCss('dmCoffeeWorkspaces20261107','/coffee-workspace-theme-v20261107.css?v=4');
      loadCss('dmDashboardKpis20261107','/dashboard-kpi-chart-v20261107.css');
      loadCss('dmAccountControl20261107','/account-subscription-v20261107.css');
      loadCss('dmAdvancedLive20261108','/advanced-analytics-v20261108.css');
      loadCss('dmProductGalleryWidgetDrag20261108','/pos-gallery-widget-drag-v20261108.css');
      loadCss('dmBranchCampaignNotifications','/franchise-promotions-branches-v20261108.css');
  }
  // Apply the original POS theme before login or account data can be rendered.
  loadSharedPresentationStyles();

  const isVisible = el => !!el && !el.classList.contains('hidden');

  function showRecoveryLogin(message) {
    document.body.classList.remove('legacy-authenticated');
    const auth = document.getElementById('authScreen');
    const app = document.getElementById('app');
    if(app){app.inert=true;app.setAttribute('aria-hidden','true');app.classList.add('hidden');}
    auth?.classList.remove('hidden');
    const title = document.getElementById('authTitle');
    const hint = document.getElementById('authHint');
    const submit = document.getElementById('authSubmit');
    if (title) title.textContent = 'Welcome Back, Please login to your account';
    if (hint) hint.textContent = message || '';
    if (submit) submit.textContent = 'Sign In';
  }

  // Start independent network downloads together, but execute scripts in their proven dependency order.
  function preloadEnhancementScripts(){
    for(const src of ["/supply-franchise.js?v=1.5.79","/tenant-billing-ui.js?v=1","/pos-finance.js?v=20261107c","/pos-quickpay-v1556.js","/mobile-nav-v1529.js","/live-refresh.js","/v15-safe.js","/v153-features.js","/v154-tuning.js","/v155-features.js","/v156-features.js","/pos-refresh.js","/dashboard-v1512.js","/dashboard-compact-v1571.js","/dashboard-experience-v1573.js?v=20261107c","/sales-csv-import-v1572.js","/premium-dashboard-feature-gallery-v1533.js","/reference-dashboard-preview-v1535.js","/plan-dashboard-v1570.js","/pos-categories-admin.js","/catalog-batch-v1544.js","/internal-chat.js","/refresh-controls-v20261107.js"]){
      const link=document.createElement('link');
      link.rel='preload';link.as='script';
      link.href=src+(src.includes('?')?'&':'?')+'v='+encodeURIComponent(VERSION);
      document.head.appendChild(link);
    }
  }

  let scopedFinanceStarted=false;
  async function startScopedFinanceWhenAppReady(){
    if(scopedFinanceStarted || !window.donmacFranchiseUnified || !isVisible(document.getElementById('app')))return;
    scopedFinanceStarted=true;
    try{
      // Keep the same mobile navigation behavior for newly provisioned and legacy franchises.
      await loadScript('/mobile-nav-v1529.js?v=20261116-shell');
      // The original Main POS shell still needs the matching enhancement styles.
      loadCss('supplyFranchiseLiveCss','/supply-franchise.css');
      loadCss('internalChatLiveCss','/internal-chat.css');
      loadCss('floatingChatLiveCss','/sidebar-chat-floating-v1523.css');
      loadCss('chatResponsiveLiveCss','/sidebar-chat-responsive-v1527.css');
      // Shared Main Office procurement catalog; orders and conversations are
      // still filtered by the authenticated franchise workspace on the server.
      await loadScript('/supply-franchise.js?v=20261116-live-franchise');
      await loadScript('/internal-chat.js?v=20261116-live-franchise');
      window.donmacChat?.loggedIn(window.donmacChatUserId||null);
      // The initial sidebar view may have been selected before these
      // enhancement modules finished loading. Open its data immediately.
      const currentView=document.querySelector('.view.active')?.id;
      if(currentView==='view-supply')await window.donmacSupply?.open?.();
      if(currentView==='view-chat')window.donmacChat?.refreshContacts?.();
      loadCss('posFinanceV20261107','/pos-finance.css');
      loadCss('posCatalogV1544Css','/pos-catalog-v1544.css');
      loadCss('posCategoryAdminCss','/pos-categories-admin.css');
      await loadScript('/pos-categories-admin.js?v=20261116-isolated');
      await loadScript('/catalog-batch-v1544.js?v=20261115-isolated');
      // Live Plan analytics use the dedicated /api/live/dashboard endpoints.
      // Never invoke the legacy global sales and product tables for a franchise.
      await loadScript('/dashboard-v1512.js');
      loadCss('planDashboardV1570Css','/plan-dashboard-v1570.css');
      await loadScript('/plan-dashboard-v1570.js?v=20261117-live-plan');
      await loadScript('/dashboard-experience-v1573.js?v=20261107c');
      await loadScript('/pos-finance.js?v=20261115-isolated');
      await loadScript('/refresh-controls-v20261107.js');
      await loadScript('/notifications-campaigns-v20261108.js?v=20261117-live-bell');
      const view=document.querySelector('.view.active')?.id;
      if(view==='view-transactions'||view==='view-expenses')window.donmacFinance?.open(view.slice(5));
    }catch(err){scopedFinanceStarted=false;console.error('Isolated finance display:',err);}
  }
  async function startEnhancementsWhenAppIsReady() {
    if(window.donmacFranchiseUnified){await startScopedFinanceWhenAppReady();return;}
    if (enhancementsStarted) return;
    const app = document.getElementById('app');
    if (!isVisible(app)) return;
    enhancementsStarted = true;
    try {
      preloadEnhancementScripts();
      loadSharedPresentationStyles();

      // Supply Chain initializes independently of optional dashboard/chat layers.
      await loadScript('/supply-franchise.js?v=1.5.79');
      await loadScript('/tenant-billing-ui.js?v=1');
      await loadScript('/pos-finance.js?v=20261107c');
      await loadScript('/pos-quickpay-v1556.js');
      window.donmacSupply?.refreshNotices?.();

      // Critical navigation is initialized first; optional POS enhancements must not block More.
      await loadScript('/mobile-nav-v1529.js');
      await loadScript('/live-refresh.js');
      await loadScript('/v15-safe.js');
      await loadScript('/v153-features.js');
      await loadScript('/v154-tuning.js');
      await loadScript('/v155-features.js');
      await loadScript('/v156-features.js');
      await loadScript('/pos-refresh.js');
      await loadScript('/dashboard-v1512.js');
      await loadScript('/dashboard-compact-v1571.js');
      await loadScript('/dashboard-experience-v1573.js?v=20261107c');
      await loadScript('/sales-csv-import-v1572.js');
      // Admin-only read-only preview; keep all current dashboard renderers unchanged.
      await loadScript('/premium-dashboard-feature-gallery-v1533.js');
      await loadScript('/reference-dashboard-preview-v1535.js');
      await loadScript('/plan-dashboard-v1570.js');
      await loadScript('/advanced-analytics-v20261108.js');
      await loadScript('/pos-categories-admin.js');
      await loadScript('/catalog-batch-v1544.js');
      await loadScript('/internal-chat.js');
      await loadScript('/refresh-controls-v20261107.js');
      await loadScript('/notifications-campaigns-v20261108.js');
      window.donmacChat?.loggedIn(window.donmacChatUserId||null);



      console.info('Don Macchiatos POS v1.5.70 plan dashboard insights started.');
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
    .then(() => loadScript('/pos-stock-limit-v20261114.js'))
    .then(() => loadScript('/franchise-unified-adapter.js'))
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
