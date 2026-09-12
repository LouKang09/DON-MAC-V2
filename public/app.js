// Coffee POS v1.5.0 loader: core app + live sync + feature layer.
(() => {
  const VERSION = '1.5.0';
  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${src}${src.includes('?')?'&':'?'}v=${VERSION}`;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(s);
  });
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = `/v15.css?v=${VERSION}`;
  document.head.appendChild(css);
  loadScript('/ui-utils.js')
    .then(() => loadScript('/app-core.js'))
    .then(() => loadScript('/live-refresh.js'))
    .then(() => loadScript('/v15-features.js'))
    .catch(err => console.error(err));
})();
