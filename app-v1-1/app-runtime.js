(() => {
  'use strict';
  const native = location.origin === 'https://appassets.androidplatform.net';
  const standalone = () => native || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pending = new Map();
  let serial = 0, installPrompt = null, registration = null, reloading = false, offlineReady = false;
  let updateWorker = null, updateRequested = false, newControllerReady = false, updateTimer = null;
  let updateCheck = null, lastUpdateCheck = 0;
  let hadController = Boolean(navigator.serviceWorker?.controller);
  const updateViewKey = 'zls_update_view_v1:' + new URL('./', location.href).pathname;
  const byId = id => document.getElementById(id);
  const notify = text => { if (typeof window.toast === 'function') window.toast(text); };
  const bridge = () => native && window.ZLSNative && typeof window.ZLSNative.postMessage === 'function';
  function callNative(action, payload = {}) {
    if (!bridge()) return Promise.reject(new Error('请更新 Android System WebView 后重试'));
    const id = String(++serial);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('操作超时，请重试')); }, action === 'saveFile' ? 600000 : 10000);
      pending.set(id, {resolve, reject, timer});
      try { window.ZLSNative.postMessage(JSON.stringify({id, action, ...payload})); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  function acceptResult(event) {
    try {
      const data = JSON.parse(event.data), item = pending.get(String(data.id));
      if (!item) return;
      clearTimeout(item.timer); pending.delete(String(data.id));
      if (data.ok) item.resolve(data); else item.reject(new Error(data.error || '操作未完成'));
    } catch (_) {}
  }
  async function download(blob, name) {
    if (native) {
      if (blob.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB，请在网页版下载');
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('无法读取导出文件'));
        reader.readAsDataURL(blob);
      });
      const result = await callNative('saveFile', {name, mime: blob.type.split(';')[0] || 'application/octet-stream', base64});
      if (!result.cancelled) notify('文件已保存');
      return;
    }
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function handleBack() {
    const input = document.activeElement;
    if (input && /^(INPUT|TEXTAREA|SELECT)$/.test(input.tagName)) { input.blur(); return true; }
    const dialogs = document.querySelectorAll('dialog[open]');
    if (dialogs.length) { dialogs[dialogs.length - 1].close(); return true; }
    const full = byId('zlsFullDetail');
    if (full?.classList.contains('open')) { byId('zlsFullBack')?.click(); return true; }
    const overlays = document.querySelectorAll('.overlay.show');
    if (overlays.length) { overlays[overlays.length - 1].classList.remove('show'); return true; }
    const drawer = byId('vehicleDrawer');
    if (byId('map')?.classList.contains('active') && drawer?.classList.contains('expanded')) {
      if (typeof setDrawerExpanded === 'function') setDrawerExpanded(false);
      return true;
    }
    if (!byId('home')?.classList.contains('active') && typeof goPage === 'function') {
      goPage('home'); window.scrollTo({top:0, behavior:'instant'}); return true;
    }
    return false;
  }
  function setForeground(visible) {
    window.__zlsAppBackground = !visible;
    if (!visible && typeof stopDriveFrames === 'function') stopDriveFrames();
    if (visible && typeof syncDriveMotion === 'function' && byId('map')?.classList.contains('active')) syncDriveMotion();
  }
  window.ZLS_APP = {
    native, download, handleBack, setForeground,
    copyText: text => native ? callNative('copyText', {text}) : navigator.clipboard.writeText(text)
  };
  document.documentElement.classList.toggle('app-native', native);
  document.documentElement.classList.toggle('app-installed', standalone());
  if (bridge()) window.ZLSNative.onmessage = acceptResult;

  function updateStatus() {
    const installed = standalone();
    document.documentElement.classList.toggle('app-installed', installed);
    byId('appInstall').hidden = installed;
    byId('appEnvironment').textContent = native ? '安卓 APP · 1.1.0' : installed ? '桌面应用 · 1.1.0' : '移动网页版 · 1.1.0';
    byId('appConnection').textContent = navigator.onLine ? '网络已连接' : '当前离线';
    byId('appNetworkBanner').hidden = navigator.onLine;
    byId('appOfflineNote').textContent = native ? '车辆图像、测试记录与本地路线已随应用内置。在线地图、天气和设备服务需要网络。' : offlineReady ? '应用页面已缓存，可离线查看内置测试记录与本地路线。在线地图、天气和设备服务需要网络。' : '首次联网打开后缓存应用页面。缓存完成后，断网也可查看内置测试记录与本地路线。';
  }
  async function install() {
    if (installPrompt) {
      const prompt = installPrompt; installPrompt = null;
      await prompt.prompt(); await prompt.userChoice; updateStatus(); return;
    }
    byId('appInstallText').textContent = location.protocol !== 'https:'
      ? '请先使用部署后的 HTTPS 网址打开本应用，再添加到手机桌面。直接打开本地 HTML 文件无法安装。'
      : ios ? '在 Safari 中打开当前网址，点击“分享”，选择“添加到主屏幕”，再点“添加”。以后可从桌面图标直接打开。'
      : '请在支持安装的手机浏览器中打开当前网址，进入浏览器菜单，选择“安装应用”或“添加到主屏幕”。微信内可先选择“在浏览器打开”。';
    byId('appInstallHelp').showModal();
  }
  function updateBar() {
    let bar = byId('appUpdateBanner');
    if (bar) return bar;
    const style = document.createElement('style');
    style.textContent = '#appUpdateBanner{position:fixed;left:12px;right:12px;bottom:calc(78px + env(safe-area-inset-bottom,0px));z-index:2147483000;max-width:470px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;border:1px solid #cddfed;border-radius:16px;background:#f7fbff;color:#18344b;box-shadow:0 8px 30px #0d263b30;font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif}#appUpdateBanner[hidden]{display:none!important}#appUpdateBanner strong{display:block;font-size:14px}#appUpdateBanner small{display:block;color:#526b7d;margin-top:2px;font-size:11px}#appUpdateBanner button{flex:none;min-height:42px;padding:9px 13px;border:0;border-radius:10px;background:#205b91;color:#fff;font-family:inherit;font-size:13px;font-weight:600;line-height:1.3;cursor:pointer}#appUpdateBanner button:disabled{opacity:.65;cursor:wait}#appUpdateBanner button:focus-visible{outline:3px solid #91bce1;outline-offset:3px}';
    document.head.appendChild(style);
    bar = document.createElement('div');
    bar.id = 'appUpdateBanner'; bar.hidden = true;
    bar.setAttribute('role','status'); bar.setAttribute('aria-live','polite');
    const copy = document.createElement('div'), title = document.createElement('strong'), note = document.createElement('small');
    title.id = 'appUpdateBannerTitle'; note.id = 'appUpdateBannerNote';
    title.textContent = '新版已就绪'; note.textContent = '更新后继续查看当前车辆';
    const button = document.createElement('button');
    button.id = 'appUpdateNow'; button.type = 'button'; button.textContent = '立即更新';
    button.addEventListener('click', applyUpdate);
    copy.appendChild(title); copy.appendChild(note); bar.appendChild(copy); bar.appendChild(button);
    document.body.appendChild(bar);
    return bar;
  }
  function showUpdate(message, busy = false) {
    updateBar().hidden = false;
    byId('appUpdateBannerTitle').textContent = message || '新版已就绪';
    byId('appUpdateBannerNote').textContent = busy ? '正在切换完整版本，请稍候' : '更新后继续查看当前车辆';
    const primary = byId('appUpdateNow');
    primary.disabled = busy; primary.textContent = busy ? '正在更新…' : newControllerReady ? '重新打开' : '立即更新';
    const existing = byId('appUpdate');
    if (existing) { existing.hidden = false; existing.disabled = busy; existing.onclick = applyUpdate; }
  }
  function rememberUpdateView() {
    // Persist view-only guest state. Never persist credentials, backend tokens or server records.
    const local = typeof state !== 'undefined' && state.backend === false;
    const saved = {
      at:Date.now(), entered:local && document.body.classList.contains('platform-ready'),
      vehicle:local ? state.current : null,
      page:typeof activePageId === 'function' ? activePageId() : 'home',
      playbackCursor:local && Number.isFinite(state.playbackCursor) ? state.playbackCursor : 0,
      replayPlaying:local && Boolean(state.replayTimer),
      lastCheck:local ? state.lastCheck : null,
      replayRange:byId('replayRange')?.value, scrollY:window.scrollY || 0
    };
    try { sessionStorage.setItem(updateViewKey,JSON.stringify(saved)); return; } catch (_) {}
    try { history.replaceState({...history.state,zlsUpdateView:saved},''); } catch (_) {}
  }
  async function restoreUpdateView() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(updateViewKey) || 'null'); sessionStorage.removeItem(updateViewKey); } catch (_) {}
    if (!saved && history.state?.zlsUpdateView) {
      saved = history.state.zlsUpdateView;
      try { const next = {...history.state}; delete next.zlsUpdateView; history.replaceState(next,''); } catch (_) {}
    }
    if (!saved || Date.now() - Number(saved.at) < 0 || Date.now() - Number(saved.at) > 900000) return;
    if (!saved.entered || typeof state === 'undefined' || state.backend !== false || typeof login !== 'function') return;
    // Fallback telemetry is created during login, so restore its frame before constructing it.
    if (Number.isFinite(saved.playbackCursor)) state.playbackCursor = Math.max(0, Math.min(100000, saved.playbackCursor));
    await login();
    if (typeof vehicles !== 'undefined' && vehicles.some(vehicle => vehicle.id === saved.vehicle)) {
      if (typeof selectFleetVehicle === 'function') selectFleetVehicle(saved.vehicle);
      else state.current = saved.vehicle;
    }
    if (saved.lastCheck && typeof saved.lastCheck === 'object') state.lastCheck = saved.lastCheck;
    if (['home','map','safety','ops','mine'].includes(saved.page) && typeof goPage === 'function') goPage(saved.page);
    setTimeout(() => {
      const range = byId('replayRange');
      if (range && saved.replayRange !== undefined) {
        if (saved.replayPlaying && !state.replayTimer && typeof toggleReplay === 'function') toggleReplay();
        const value = Number(saved.replayRange);
        if (Number.isFinite(value)) range.value = String(Math.max(Number(range.min)||0,Math.min(Number(range.max)||20,value)));
        if (typeof renderReplay === 'function') renderReplay(false);
      }
      window.scrollTo({top:Math.max(0,Number(saved.scrollY)||0),behavior:'instant'});
    },100);
  }
  function reloadUpdatedVersion() {
    if (reloading) return;
    rememberUpdateView(); reloading = true;
    clearTimeout(updateTimer); location.reload();
  }
  function applyUpdate() {
    if (updateRequested || reloading) return;
    if (newControllerReady) { reloadUpdatedVersion(); return; }
    const worker = registration?.waiting || updateWorker;
    if (!worker || worker.state === 'redundant') {
      showUpdate('正在重新检查版本'); checkForUpdate(true); return;
    }
    updateRequested = true; showUpdate('正在更新',true);
    try { worker.postMessage({type:'ACTIVATE_UPDATE'}); }
    catch (_) { updateRequested = false; showUpdate('更新未完成，请重试'); return; }
    updateTimer = setTimeout(() => {
      if (!reloading) { updateRequested = false; showUpdate('更新未完成，请重试'); }
    },12000);
  }
  function offerUpdate(worker) {
    if (!worker || !navigator.serviceWorker.controller || reloading) return;
    updateWorker = worker;
    if (!updateRequested) showUpdate('新版已就绪');
  }
  function controllerChanged() {
    const replaced = hadController;
    hadController = Boolean(navigator.serviceWorker.controller);
    if (!hadController || (!replaced && !updateRequested) || reloading) return;
    newControllerReady = true; updateWorker = null;
    if (updateRequested) reloadUpdatedVersion();
    else showUpdate('新版已就绪'); // An update activated in another tab: do not interrupt the current page.
  }
  function checkForUpdate(force = false) {
    if (!registration || navigator.onLine === false || document.hidden || updateCheck) return updateCheck;
    if (!force && Date.now() - lastUpdateCheck < 60000) return;
    lastUpdateCheck = Date.now();
    updateCheck = registration.update().then(() => offerUpdate(registration.waiting)).catch(() => {}).finally(() => { updateCheck = null; });
    return updateCheck;
  }
  async function prepareOffline() {
    if (native || !('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
    try {
      navigator.serviceWorker.addEventListener('controllerchange',controllerChanged);
      registration = await navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'});
      offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offerUpdate(registration.waiting || worker); });
      });
      checkForUpdate(true);
      document.addEventListener('visibilitychange',() => { if (!document.hidden) checkForUpdate(); });
      window.addEventListener('focus',() => checkForUpdate());
      window.addEventListener('online',() => checkForUpdate(true));
      setInterval(() => checkForUpdate(),300000);
      await navigator.serviceWorker.ready;
      offlineReady = true; updateStatus();
    } catch (_) {
      byId('appOfflineNote').textContent = '当前浏览器未完成离线缓存；请保持联网，或在系统浏览器重新打开。';
    }
  }
  function init() {
    byId('appInstall').addEventListener('click', () => install().catch(error => notify(error.message)));
    byId('appInstallClose').addEventListener('click', () => byId('appInstallHelp').close());
    byId('appBackHome').addEventListener('click', () => { goPage('home'); window.scrollTo(0,0); });
    updateStatus(); restoreUpdateView().catch(() => {}); prepareOffline();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    window.addEventListener('appinstalled', () => { installPrompt = null; updateStatus(); notify('已添加到手机桌面'); });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; updateStatus(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
