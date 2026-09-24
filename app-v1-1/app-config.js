/* Optional backend URL. Leave empty to use the bundled project test records. */
window.ZLS_APP_CONFIG = { version: '1.1.0', apiBase: '' };
(() => {
  const config = window.ZLS_CONFIG || (window.ZLS_CONFIG = {});
  const endpoint = window.ZLS_APP_CONFIG.apiBase.trim().replace(/\/$/, '');
  config.apiBase = endpoint.startsWith('https://') ? endpoint : '';
  config.staticPreview = !config.apiBase;
})();
