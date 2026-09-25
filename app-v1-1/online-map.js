/* Online basemap: Leaflet 1.9.4 / OpenStreetMap. Routing: OSRM public service.
 * Only the visible viewport requests tiles. Tiles use the browser's normal HTTP
 * cache and are deliberately excluded from the service worker's asset list.
 * Legacy AMap route anchors are explicitly tagged GCJ-02; the conversion below
 * is approximate and does not turn the bundled test points into surveyed data.
 */
'use strict';
const onlineMap = {
  tileReady:false, batchOK:0, batchErrors:0, userLocal:false, failureUntil:0,
  tileStatus:'idle', tileError:'', lastTileRetryAt:0,
  routeStatus:'idle', routeId:'', routeSource:'', routeKind:'none', routeError:'',
  inflight:new Map(), attempts:new Map(), routeFailures:new Map(),
  queue:Promise.resolve(), lastRequestAt:0, tiles:null, tileTimer:null
};
const mapOptions = CFG.map || {};
function mapToWgs84(point, source = mapOptions.sourceCoordSystem) {
  const lng=Number(point[0]),lat=Number(point[1]);
  if(source!=='gcj02'||lng<72.004||lng>137.8347||lat<.8293||lat>55.8271)return[lng,lat];
  const pi=Math.PI,x=lng-105,y=lat-35;
  let dLat=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  dLat+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLat+=(20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3;
  dLat+=(160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3;
  let dLng=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  dLng+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLng+=(20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3;
  dLng+=(150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3;
  const rad=lat*pi/180,s=Math.sin(rad),magic=1-.006693421622965943*s*s;
  dLat=dLat*180/((6378245*(1-.006693421622965943))/(magic*Math.sqrt(magic))*pi);
  dLng=dLng*180/(6378245/Math.sqrt(magic)*Math.cos(rad)*pi);
  return[lng-dLng,lat-dLat];
}
function leafletPoint(p){return[p[1],p[0]]}
function roadSignature(id){return JSON.stringify([mapOptions.sourceCoordSystem,mapOptions.routeUrl,routeLibrary[id]?.localPath])}
function routeCacheKey(id){return 'zls_osrm_wgs84_v2_'+id}
function validRoadPath(path){return Array.isArray(path)&&path.length>2&&path.length<20000&&path.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>104&&p[0]<108&&p[1]>28&&p[1]<31)}
function readRoadCache(id){
  try{const entry=JSON.parse(localStorage.getItem(routeCacheKey(id)));return entry&&entry.signature===roadSignature(id)&&Date.now()-entry.savedAt<7*86400000&&validRoadPath(entry.path)?entry:null}catch{return null}
}
function saveRoadCache(id,path,distance){try{localStorage.setItem(routeCacheKey(id),JSON.stringify({savedAt:Date.now(),signature:roadSignature(id),path,distance,crs:'WGS84',source:'OSRM route'}))}catch{}}
function ensureOnlineMapInfo(){
  if($('onlineMapInfo'))return;
  const box=document.createElement('div');box.id='onlineMapInfo';box.className='online-map-info';
  const attribution=mapOptions.tileAttribution||'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  box.innerHTML='<div class="online-map-status"><span id="onlineMapMessage" role="status">在线底图连接中</span><button id="onlineMapRetry" type="button">重试底图</button></div><div id="onlineMapAttribution" class="online-map-attribution" hidden>'+attribution+' · 路线 <a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">地图纠错</a></div>';
  $('map').appendChild(box);
  const external=document.createElement('a');external.id='onlineMapExternal';external.textContent='在高德查看路段';external.target='_blank';external.rel='noopener';external.title='在新标签页打开高德地图';
  box.querySelector('.online-map-status').appendChild(external);
  $('onlineMapRetry').onclick=()=>{onlineMap.userLocal=false;loadAmap(true)};
}
function updateOnlineMapInfo(){
  ensureOnlineMapInfo();
  const current=onlineMap.routeId===state.current,road=current&&onlineMap.routeKind==='road';
  let message='本地测试路线示意 · 非真实道路轨迹',retry='连接在线底图';
  if(state.onlineMapVisible){
    const base=navigator.onLine?'在线底图正常':'离线底图缓存';
    message=road?base+' · '+(onlineMap.routeSource==='cache'?'道路缓存':'道路规划')+' / 车辆轨迹预览':base+' · 虚线为测试连线，非道路规划';
    if(current&&onlineMap.routeStatus==='loading')message=base+' · '+(road?'保留现有路线，正在刷新':'虚线为测试连线，正在规划道路');
    if(current&&onlineMap.routeStatus==='error')message=base+' · '+(road?'道路刷新失败，已保留原路线':'道路规划失败，虚线为测试连线');
    if(onlineMap.tileStatus==='partial')message+=' · 部分底图未加载';
    retry=current&&onlineMap.routeStatus==='error'?'重试道路规划':'刷新道路路线';
  }else if(!onlineMap.userLocal){
    if(onlineMap.tileStatus==='loading')message='在线底图连接中 · 暂时显示本地示意';
    else if(onlineMap.tileError)message=onlineMap.tileError+' · 本地示意仍可用';
    retry='重试在线底图';
  }
  $('onlineMapMessage').textContent=message;
  $('onlineMapAttribution').hidden=!state.onlineMapVisible;
  $('onlineMapRetry').textContent=retry;
  const view=mapRuntimeState();setCachedText('mapRouteMode',view.label);
  const badge=$('mapRouteMode');if(badge){badge.classList?.remove('online','warn','bad');badge.classList?.add(view.level);badge.title=view.detail}
  const external=$('onlineMapExternal'),route=routeNow();
  if(external&&route.center){const url=new URL('https://uri.amap.com/marker');url.searchParams.set('position',route.center.join(','));url.searchParams.set('name',route.title);url.searchParams.set('src','zhi-lu-shao-bing');url.searchParams.set('coordinate','gaode');url.searchParams.set('callnative','0');external.href=url.href}
  const info=$('onlineMapInfo'),map=$('map');
  if(info&&map&&info.getBoundingClientRect){const height=Math.ceil(info.getBoundingClientRect().height);if(height>0)map.style.setProperty('--online-map-info-height',height+'px')}
}
function mapRuntimeState(){
  if(state.onlineMapVisible&&state.map){
    const road=onlineMap.routeId===state.current&&onlineMap.routeKind==='road';
    return{level:road&&!onlineMap.routeError&&navigator.onLine?'online':'warn',label:navigator.onLine?(road?'在线道路':'在线底图'):'底图缓存',detail:(mapOptions.providerName||'OpenStreetMap')+'底图 / '+(road?'OSRM道路路线 / 车辆轨迹预览':'虚线为测试点连线，不是道路规划')+(onlineMap.routeError?' / '+onlineMap.routeError:'')};
  }
  if(onlineMap.userLocal)return{level:'warn',label:'测试示意',detail:'已手动切换为本地测试示意，可点击连接在线底图'};
  if(onlineMap.tileStatus==='loading')return{level:'warn',label:'底图连接中',detail:'在线底图连接中，暂时显示本地测试示意'};
  return{level:onlineMap.tileError?'bad':'warn',label:'测试示意',detail:onlineMap.tileError||'本地测试路线示意，不代表真实道路匹配'};
}
function clearRoadOverlays(){
  (state.localOverlays||[]).forEach(layer=>{try{state.map?.removeLayer(layer)}catch{}});
  state.localOverlays=[];state.planPolyline=null;state.donePolyline=null;state.mapMarker=null;state.roadPath=null;state.localRouteId=null;
}
function fitCurrentRoadRoute(){
  if(!state.map)return;
  state.map.resize();
  if(state.roadPath?.length){
    const pad=routeFitPadding();state.map.fitBounds(state.roadPath.map(leafletPoint),{paddingTopLeft:[pad[3],pad[0]],paddingBottomRight:[pad[1],pad[2]+90],maxZoom:17,animate:false});
  }else state.map.setView(leafletPoint(mapToWgs84(routeNow().center)),routeNow().zoom,{animate:false});
}
function drawMapRoute(path,source){
  if(!state.map||!window.L||!validRoadPath(path)||onlineMap.userLocal)return;
  const id=state.current,test=source==='test';
  clearRoadOverlays();state.localRouteId=state.current;state.roadPath=path;
  const fraction=driveExistingFraction(state.current,tNow().progress),route=routeNow();
  const dash=test?'9 11':null;
  const outline=L.polyline(path.map(leafletPoint),{color:'#ffffff',weight:test?9:12,opacity:.96,dashArray:dash,interactive:false}).addTo(state.map);
  state.planPolyline=L.polyline(path.map(leafletPoint),{color:test?'#b57812':'#2476f3',weight:test?4:6,opacity:1,dashArray:dash,interactive:false}).addTo(state.map);
  state.donePolyline=L.polyline(localPathSlice(path,fraction).map(leafletPoint),{color:test?'#8d651e':'#08b77a',weight:test?5:7,opacity:1,dashArray:dash,interactive:false}).addTo(state.map);
  state.donePolyline.setPath=function(points){this.setLatLngs(points.map(leafletPoint))};
  state.mapMarker=L.marker(leafletPoint(localPoint(path,fraction)),{icon:L.divIcon({className:'zls-leaflet-car',html:driveOnlineMarkerContent(),iconSize:[36,70],iconAnchor:[18,35]}),zIndexOffset:1000,interactive:false}).addTo(state.map);
  state.mapMarker.setPosition=function(point){this.setLatLng(leafletPoint(point))};
  state.localOverlays=[outline,state.planPolyline,state.donePolyline,state.mapMarker];
  const levels=['normal','warn','danger'];
  (route.eventFracs||[.3,.6,.82]).forEach((f,i)=>{
    const marker=L.marker(leafletPoint(localPoint(path,f)),{icon:L.divIcon({className:'zls-leaflet-event',html:eventMarkerContent(markerColor(levels[i]),esc(route.events[i]||'测试节点')),iconSize:[160,25],iconAnchor:[8,12]}),interactive:false,zIndexOffset:50}).addTo(state.map);
    state.localOverlays.push(marker);
  });
  onlineMap.routeId=id;onlineMap.routeSource=source;onlineMap.routeKind=test?'test':'road';
  showOnlineMapMode();
  setRoadRouteState(test?'sync':'ok',test?'虚线测试连线 · 非道路规划':'道路路线已加载',route.title+'｜车辆轨迹预览');
  requestAnimationFrame(()=>{if(state.current===id&&state.localRouteId===id&&state.roadPath===path){fitCurrentRoadRoute();syncDriveMotion()}});
  updateOnlineMapInfo();
}
function drawMatchedRoadRoute(path,source){
  onlineMap.routeStatus='matched';onlineMap.routeError='';onlineMap.routeFailures.delete(state.current);
  drawMapRoute(path,source);
}
function drawTestMapRoute(){
  if(state.localRouteId===state.current&&state.roadPath)return;
  onlineMap.routeStatus='idle';onlineMap.routeError=onlineMap.routeFailures.get(state.current)||'';
  if(onlineMap.routeError)onlineMap.routeStatus='error';
  const path=(routeNow().localPath||[]).map(p=>mapToWgs84(p));
  drawMapRoute(path,'test');
}
function updateRoadProgress(){syncDriveMotion()}
function routeAnchorPoints(route){
  const path=route.localPath||[],last=path.length-1;
  return [...new Set([0,Math.floor(last*.25),Math.floor(last*.5),Math.floor(last*.75),last])].map(i=>mapToWgs84(path[i]));
}
function requestRoadMatchedRoute(force=false){
  if(!state.map||!window.L||onlineMap.userLocal)return Promise.resolve();
  const id=state.current,route=routeLibrary[id],signature=roadSignature(id);
  if(!force&&state.localRouteId===id&&state.roadPath&&onlineMap.routeKind==='road'){showOnlineMapMode();return Promise.resolve()}
  const cache=readRoadCache(id);
  if(cache&&!force){drawMatchedRoadRoute(cache.path,'cache');return Promise.resolve()}
  if(state.localRouteId!==id||!state.roadPath){
    if(cache)drawMatchedRoadRoute(cache.path,'cache');else drawTestMapRoute();
  }
  if(onlineMap.inflight.has(id)){onlineMap.routeId=id;onlineMap.routeStatus='loading';updateOnlineMapInfo();return onlineMap.inflight.get(id)}
  const last=onlineMap.attempts.get(id)||0;
  const cooldown=Math.max(5000,Number(mapOptions.routeRetryMs)||10000),remaining=cooldown-(Date.now()-last);
  if(remaining>0){if(force)toast('道路规划请在'+Math.ceil(remaining/1000)+'秒后重试');updateOnlineMapInfo();return Promise.resolve()}
  onlineMap.routeId=id;onlineMap.routeStatus='loading';onlineMap.routeError='';updateOnlineMapInfo();
  const job=onlineMap.queue.catch(()=>{}).then(async()=>{
    if(state.current!==id||onlineMap.userLocal)return;
    const delay=Math.max(0,1100-(Date.now()-onlineMap.lastRequestAt));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(state.current!==id||onlineMap.userLocal)return;
    onlineMap.lastRequestAt=Date.now();onlineMap.attempts.set(id,Date.now());
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const anchors=routeAnchorPoints(route),coordinates=anchors.map(p=>p.map(n=>n.toFixed(6)).join(',')).join(';');
      const url=(mapOptions.routeUrl||'https://router.project-osrm.org/route/v1/driving/')+coordinates+'?overview=full&geometries=geojson&steps=false&alternatives=false';
      const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
      if(!response.ok)throw new Error('ROUTE_HTTP_'+response.status);
      const result=await response.json(),path=result.routes?.[0]?.geometry?.coordinates;
      if(result.code!=='Ok'||!validRoadPath(path)||result.routes[0].distance>150000)throw new Error('ROUTE_UNAVAILABLE');
      saveRoadCache(id,path,result.routes[0].distance);
      if(state.current===id&&roadSignature(id)===signature&&!onlineMap.userLocal)drawMatchedRoadRoute(path,'online');
    }catch(error){
      const reason=error?.name==='AbortError'?'道路规划连接超时':'道路规划服务连接失败';onlineMap.routeFailures.set(id,reason);
      if(state.current===id&&!onlineMap.userLocal){
        if(state.localRouteId!==id||!state.roadPath)drawTestMapRoute();
        onlineMap.routeStatus='error';onlineMap.routeId=id;onlineMap.routeError=reason;
        // Routing is optional. A failed route must never hide working map tiles.
        if(onlineMap.tileReady)showOnlineMapMode();
        updateOnlineMapInfo();
      }
    }finally{clearTimeout(timer)}
  }).finally(()=>{onlineMap.inflight.delete(id)});
  onlineMap.queue=job;onlineMap.inflight.set(id,job);return job;
}
function enterStableLocalMapMode(note){
  $('map')?.classList.remove('amap-ready','amap-loading');
  if($('fallbackMap'))$('fallbackMap').style.display='block';if($('amap'))$('amap').style.visibility='hidden';
  state.onlineMapVisible=false;hidePcMapStatus();
  setRoadRouteState('sync','本地测试路线示意',(note||routeNow().title)+'｜非真实道路轨迹');
  updateOnlineMapInfo();syncDriveMotion();
}
function showOnlineMapMode(){
  if(!state.map||!onlineMap.tileReady||onlineMap.userLocal)return false;
  $('map')?.classList.remove('amap-loading');$('map')?.classList.add('amap-ready');
  if($('amap'))$('amap').style.visibility='visible';if($('fallbackMap'))$('fallbackMap').style.display='none';
  state.onlineMapVisible=true;hidePcMapStatus();updateOnlineMapInfo();return true;
}
function cleanupAmapScripts(){}
function scheduleAmapRetry(){} // Manual retry only; no repeated tile polling.
function loadAmap(manual=false){
  ensureOnlineMapInfo();
  if(manual){onlineMap.userLocal=false;onlineMap.failureUntil=0}
  if(onlineMap.userLocal||(!manual&&Date.now()<onlineMap.failureUntil))return;
  if(!mapOptions.enabled||!window.L){onlineMap.tileStatus='error';onlineMap.tileError=!mapOptions.enabled?'在线底图未启用':'在线底图组件未加载';state.amapLoadError=onlineMap.tileError;onlineMap.failureUntil=Date.now()+10000;enterStableLocalMapMode();return}
  if(!navigator.onLine){onlineMap.tileError='网络未连接';state.amapLoadError=onlineMap.tileError;if(onlineMap.tileReady)showOnlineMapMode();else{onlineMap.tileStatus='offline';enterStableLocalMapMode()}return}
  const existed=!!state.map;
  initAmap();
  if(existed&&onlineMap.tiles&&!onlineMap.tileReady&&onlineMap.tileStatus!=='loading')retryMapTiles(manual);
  if(state.map)requestRoadMatchedRoute(manual);
}
function retryMapTiles(manual=false){
  if(!onlineMap.tiles||onlineMap.userLocal||!navigator.onLine||!mapPageIsVisible())return false;
  const wait=5000-(Date.now()-onlineMap.lastTileRetryAt);
  if(wait>0){if(manual)toast('底图请在'+Math.ceil(wait/1000)+'秒后重试');return false}
  onlineMap.lastTileRetryAt=Date.now();onlineMap.failureUntil=0;onlineMap.tileStatus='loading';onlineMap.tileError='';
  onlineMap.batchOK=0;onlineMap.batchErrors=0;state.amapLoading=true;state.amapLoadError='';
  onlineMap.tiles.redraw();updateOnlineMapInfo();return true;
}
function initAmap(){
  if(!window.L||!mapPageIsVisible())return;
  if(state.map){state.map.resize();showOnlineMapMode();return}
  state.amapLoading=true;state.amapLoadError='';onlineMap.tileStatus='loading';onlineMap.tileError='';updateOnlineMapInfo();
  const route=routeNow();
  try{
    state.map=L.map('amap',{zoomControl:false,attributionControl:false,preferCanvas:false,maxZoom:19,minZoom:3});
    state.map.resize=()=>state.map.invalidateSize({pan:false,debounceMoveend:true});
    state.map.setView(leafletPoint(mapToWgs84(route.center)),Math.min(route.zoom,15));
    state.localOverlays=[];state.amapLoaded=true;
    state.map.on('click',()=>setDrawerExpanded(false));
    const tiles=L.tileLayer(mapOptions.tileUrl||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:Number(mapOptions.maxZoom)||19,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:0,referrerPolicy:'strict-origin-when-cross-origin'});
    onlineMap.tiles=tiles;
    const fail=reason=>{onlineMap.tileReady=false;onlineMap.tileStatus=navigator.onLine?'error':'offline';onlineMap.tileError=reason;state.amapLoading=false;state.amapLoadError=reason;onlineMap.failureUntil=Date.now()+5000;enterStableLocalMapMode()};
    tiles.on('loading',()=>{onlineMap.batchOK=0;onlineMap.batchErrors=0;onlineMap.tileStatus='loading';state.amapLoading=!onlineMap.tileReady;clearTimeout(onlineMap.tileTimer);onlineMap.tileTimer=setTimeout(()=>{if(!onlineMap.batchOK)fail('在线底图连接超时')},15000);updateOnlineMapInfo()});
    tiles.on('tileload',()=>{onlineMap.batchOK++;onlineMap.tileReady=true;onlineMap.tileStatus='ready';onlineMap.tileError='';state.amapLoading=false;state.amapLoadError='';if(!onlineMap.userLocal){showOnlineMapMode();syncDriveMotion()}});
    tiles.on('tileerror',()=>{onlineMap.batchErrors++});
    tiles.on('load',()=>{clearTimeout(onlineMap.tileTimer);if(!onlineMap.batchOK&&onlineMap.batchErrors)fail(navigator.onLine?'在线底图服务连接失败':'网络未连接，底图加载失败');else{state.amapLoading=false;onlineMap.tileStatus=onlineMap.batchErrors?'partial':'ready';updateOnlineMapInfo()}});
    tiles.addTo(state.map);requestRoadMatchedRoute(false);
  }catch(error){clearTimeout(onlineMap.tileTimer);try{state.map?.remove()}catch{}state.map=null;onlineMap.tiles=null;onlineMap.tileReady=false;onlineMap.tileStatus='error';onlineMap.tileError='在线底图初始化失败';state.amapLoading=false;state.amapLoaded=false;onlineMap.failureUntil=Date.now()+10000;state.amapLoadError=onlineMap.tileError;enterStableLocalMapMode()}
}
ensureOnlineMapInfo();
if($('mapLayers'))$('mapLayers').onclick=()=>{
  if(state.onlineMapVisible){onlineMap.userLocal=true;enterStableLocalMapMode();toast('已切换为本地测试路线示意')}
  else{onlineMap.userLocal=false;loadAmap(true)}
};
window.addEventListener('online',()=>{onlineMap.failureUntil=0;if(mapPageIsVisible()&&!onlineMap.userLocal)loadAmap(false)},{passive:true});
window.addEventListener('offline',()=>{clearTimeout(onlineMap.tileTimer);state.amapLoading=false;if(!onlineMap.tileReady){onlineMap.tileStatus='offline';onlineMap.tileError='网络未连接'}if(mapPageIsVisible()&&!onlineMap.userLocal){if(onlineMap.tileReady)showOnlineMapMode();else enterStableLocalMapMode()}updateOnlineMapInfo()},{passive:true});
