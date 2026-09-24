/* Open-Meteo current model conditions and hourly visibility.
 * Docs: https://open-meteo.com/en/docs
 * Data: https://open-meteo.com/ (CC BY 4.0); labels translated and units formatted.
 * This module never reads or mutates vehicle telemetry or risk records.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZLSWeather = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CACHE_PREFIX = 'zls_openmeteo_v1_';
  const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
  const CODE_LABELS = {
    0:'晴',1:'晴间多云',2:'多云',3:'阴',45:'雾',48:'雾凇',
    51:'小毛毛雨',53:'毛毛雨',55:'密集毛毛雨',56:'轻冻毛毛雨',57:'冻毛毛雨',
    61:'小雨',63:'中雨',65:'大雨',66:'轻冻雨',67:'冻雨',
    71:'小雪',73:'中雪',75:'大雪',77:'米雪',80:'小阵雨',81:'中阵雨',82:'强阵雨',
    85:'小阵雪',86:'大阵雪',95:'雷暴',96:'雷暴伴小冰雹',99:'雷暴伴冰雹'
  };
  function number(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function bounded(value, min, max) {
    const n = number(value);
    return n !== null && n >= min && n <= max ? n : null;
  }
  function icon(text, isDay) {
    text = String(text || '');
    if (/雷|冰雹/.test(text)) return '⛈️';
    if (/雾|霾/.test(text)) return '🌫️';
    if (/雪/.test(text)) return '🌨️';
    if (/雨/.test(text)) return /小|毛毛/.test(text) ? '🌦️' : '🌧️';
    if (text === '阴') return '☁️';
    if (text === '晴') return isDay === 0 ? '🌙' : '☀️';
    if (/云/.test(text)) return isDay === 0 ? '☁️' : '🌤️';
    return '🌡️';
  }
  function windDirection(value) {
    const n = bounded(value, 0, 360);
    return n === null ? '--' : ['北','东北','东','东南','南','西南','西','西北'][Math.round(n / 45) % 8];
  }
  function timeText(epochMs, withDate) {
    if (!Number.isFinite(epochMs)) return '--';
    return new Date(epochMs).toLocaleString('zh-CN', {
      timeZone:'Asia/Shanghai', ...(withDate ? {month:'2-digit',day:'2-digit'} : {}),
      hour:'2-digit',minute:'2-digit',hour12:false
    });
  }
  function visibilityText(value) {
    const n = number(value);
    if (n === null || n < 0) return '--';
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'km' : Math.round(n) + 'm';
  }
  function parse(data, id, fetchedAt) {
    if (!data || data.error || !data.current) throw new Error('WEATHER_DATA_INVALID');
    const c = data.current, seconds = number(c.time);
    if (seconds === null || seconds <= 0) throw new Error('WEATHER_TIME_INVALID');
    const code = number(c.weather_code), label = CODE_LABELS[code] || '天气未提供';
    const temp = bounded(c.temperature_2m, -100, 70);
    if (code === null && temp === null) throw new Error('WEATHER_CURRENT_EMPTY');
    const hourly = data.hourly || {}, times = Array.isArray(hourly.time) ? hourly.time : [];
    let hour = -1, latest = -Infinity;
    times.forEach((raw, i) => {
      const t = number(raw);
      if (t !== null && t <= seconds && seconds - t < 3600 && t > latest) { hour = i; latest = t; }
    });
    const visibility = hour >= 0 && Array.isArray(hourly.visibility) ? bounded(hourly.visibility[hour], 0, 1000000) : null;
    return {
      schema:1, provider:'Open-Meteo', id, source:'Open-Meteo', text:label, icon:icon(label, number(c.is_day)),
      temp, feelsLike:bounded(c.apparent_temperature, -120, 90), humidity:bounded(c.relative_humidity_2m, 0, 100),
      windDir:windDirection(c.wind_direction_10m), windScale:null, windSpeed:bounded(c.wind_speed_10m, 0, 500),
      visibility, visibilityTime:visibility === null ? null : latest * 1000, visibilityKind:'小时预报',
      precip:bounded(c.precipitation, 0, 2000), precipInterval:bounded(c.interval, 1, 86400),
      pressure:bounded(c.pressure_msl, 100, 1200), observedAt:timeText(seconds * 1000, true) + '（北京时间，模型）',
      obsTime:new Date(seconds * 1000).toISOString(), modelTime:seconds * 1000, updatedAt:fetchedAt,
      sourceUrl:'https://open-meteo.com/', licenceUrl:'https://creativecommons.org/licenses/by/4.0/',
      fromCache:false, lastError:null
    };
  }
  function requestURL(coords) {
    if (!coords || bounded(coords.latitude, -90, 90) === null || bounded(coords.longitude, -180, 180) === null) throw new Error('WEATHER_LOCATION_INVALID');
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      latitude:String(coords.latitude),longitude:String(coords.longitude),
      current:'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m',
      hourly:'visibility',forecast_days:'1',timezone:'Asia/Shanghai',timeformat:'unixtime',
      temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm'
    }).toString();
    return url.href;
  }
  function createService(options) {
    const opt = options || {}, clock = opt.now || Date.now;
    const fetcher = opt.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const storage = opt.storage || null;
    const schedule = opt.setTimeout || setTimeout, cancel = opt.clearTimeout || clearTimeout;
    const refreshMs = opt.refreshMs || 600000, timeoutMs = opt.timeoutMs || 8000;
    const modelMaxAgeMs = opt.modelMaxAgeMs || 5400000, maxCacheAgeMs = opt.maxCacheAgeMs || 86400000;
    const byVehicle = Object.create(null), inflight = Object.create(null), attempts = Object.create(null);
    function load(id) {
      if (byVehicle[id]) return byVehicle[id];
      try {
        const saved = storage && JSON.parse(storage.getItem(CACHE_PREFIX + id) || 'null');
        if (saved && saved.schema === 1 && saved.provider === 'Open-Meteo' && saved.id === id &&
            Number.isFinite(saved.modelTime) && Number.isFinite(saved.updatedAt) &&
            clock() >= saved.updatedAt && clock() - saved.updatedAt < maxCacheAgeMs) {
          byVehicle[id] = {...saved, fromCache:true};
          return byVehicle[id];
        }
      } catch (_) {}
      return null;
    }
    function get(id) {
      const item = load(id);
      if (!item) return null;
      const age = clock() - item.updatedAt, modelAge = clock() - item.modelTime;
      if (age > maxCacheAgeMs) return null;
      const recent = age >= 0 && age < refreshMs && modelAge >= -900000 && modelAge < modelMaxAgeMs;
      const live = recent && !item.fromCache && !item.lastError;
      return {...item, live, stale:!recent, status:live ? 'updated' : recent ? 'cached' : 'stale'};
    }
    function refresh(id, force) {
      if (inflight[id]) return inflight[id];
      const current = get(id), now = clock();
      if (!force && current && current.live) return Promise.resolve(current);
      if (!force && attempts[id] !== undefined && now - attempts[id] < 30000) return Promise.resolve(current);
      attempts[id] = now;
      const controller = new AbortController();
      let timer;
      const job = (async () => {
        try {
          const url = requestURL((opt.locations || {})[id]);
          if (!fetcher) throw new Error('WEATHER_FETCH_UNAVAILABLE');
          const timeout = new Promise((_, reject) => {
            timer = schedule(() => { controller.abort(); reject(new Error('WEATHER_TIMEOUT')); }, timeoutMs);
          });
          const request = (async () => {
            const response = await fetcher(url, {signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
            if (!response.ok) throw new Error('WEATHER_HTTP_' + response.status);
            return response.json();
          })();
          const payload = await Promise.race([request, timeout]);
          const record = parse(payload, id, clock());
          byVehicle[id] = record;
          try { if (storage) storage.setItem(CACHE_PREFIX + id, JSON.stringify(record)); } catch (_) {}
        } catch (error) {
          const existing = load(id);
          if (existing) byVehicle[id] = {...existing, lastError:String(error && error.message || 'WEATHER_UNAVAILABLE')};
        } finally {
          cancel(timer);
        }
        return get(id);
      })();
      inflight[id] = job;
      job.finally(() => { if (inflight[id] === job) delete inflight[id]; });
      return job;
    }
    return {get,load,refresh,refreshAll(force) { return Promise.all(Object.keys(opt.locations || {}).map(id => refresh(id, force))); }};
  }
  function sourceLabel(item) {
    if (!item || item.provider !== 'Open-Meteo') return '在线天气未连接 · 暂无数据';
    const status = item.live ? '已更新' : item.stale ? '缓存已过期' : '缓存 · 待更新';
    return 'Open-Meteo · ' + status + ' · ' + timeText(item.modelTime, true) + '模型';
  }
  return {number,icon,timeText,visibilityText,parse,requestURL,createService,sourceLabel};
});
