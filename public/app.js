// Loads the existing Coffee POS application, then the cross-terminal live refresh layer.
(() => {
  const load = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + (src.includes('?') ? '&' : '?') + 'v=1.4.2-live-refresh';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(s);
  });
  load('/app-core.js').then(() => load('/live-refresh.js')).catch(err => console.error(err));
})();
