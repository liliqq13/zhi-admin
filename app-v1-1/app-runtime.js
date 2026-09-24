(() => {
  'use strict';
  const native = location.origin === 'https://appassets.androidplatform.net';
  const standalone = () => native || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pending = new Map();
  let serial = 0, installPrompt = null, registration = null, reloading = false, offlineReady = false;
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
  function offerUpdate(worker) {
    if (!worker || !navigator.serviceWorker.controller) return;
    const button = byId('appUpdate'); button.hidden = false;
    button.onclick = () => { button.disabled = true; worker.postMessage({type:'ACTIVATE_UPDATE'}); };
  }
  async function prepareOffline() {
    if (native || !('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'});
      offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offerUpdate(registration.waiting || worker); });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !byId('appUpdate').disabled) return;
        reloading = true; location.reload();
      });
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
    updateStatus(); prepareOffline();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    window.addEventListener('appinstalled', () => { installPrompt = null; updateStatus(); notify('已添加到手机桌面'); });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; updateStatus(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
