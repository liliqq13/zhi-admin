/* Online basemap: Leaflet 1.9.4 / OpenStreetMap. Routing: OSRM public service.
 * Only the visible viewport requests tiles. Tiles use the browser's normal HTTP
 * cache and are deliberately excluded from the service worker's asset list.
 * Legacy AMap route anchors are explicitly tagged GCJ-02; the conversion below
 * is approximate and does not turn the bundled test points into surveyed data.
 */
'use strict';
const onlineMap = {
  tileReady:false, batchOK:0, batchErrors:0, userLocal:false, failureUntil:0,
  routeStatus:'idle', routeId:'', routeSource:'', inflight:new Map(), attempts:new Map(),
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
  box.innerHTML='<div class="online-map-status"><span id="onlineMapMessage" role="status">本地测试路线示意</span><button id="onlineMapRetry" type="button">重试在线地图</button></div><div id="onlineMapAttribution" class="online-map-attribution" hidden>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · 路线 <a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">地图纠错</a></div>';
  $('map').appendChild(box);
  $('onlineMapRetry').onclick=()=>{onlineMap.userLocal=false;loadAmap(true)};
}
function updateOnlineMapInfo(){
  ensureOnlineMapInfo();
  const matched=onlineMap.routeStatus==='matched'&&onlineMap.routeId===state.current;
  let message='本地测试路线示意 · 非真实道路轨迹';
  if(state.onlineMapVisible)message=matched?'在线道路规划 · 车辆轨迹预览'+(onlineMap.routeSource==='cache'?'（路线缓存）':''):'在线底图 · 测试路线尚未匹配';
  if(state.amapLoading)message='在线地图连接中 · 当前为本地测试示意';
  if(onlineMap.routeStatus==='loading'&&onlineMap.routeId===state.current)message='正在规划道路路线 · 测试点仅作参考';
  if(state.amapLoadError&&!state.onlineMapVisible)message='在线服务暂不可用 · 本地测试路线示意';
  $('onlineMapMessage').textContent=message;
  $('onlineMapAttribution').hidden=!state.onlineMapVisible;
  $('onlineMapRetry').textContent=state.onlineMapVisible?'刷新路线':'重试在线地图';
  const view=mapRuntimeState();setCachedText('mapRouteMode',view.label);
}
function mapRuntimeState(){
  if(state.onlineMapVisible&&state.map){
    const matched=onlineMap.routeStatus==='matched'&&onlineMap.routeId===state.current;
    return{level:matched?'online':'warn',label:matched?'在线道路':'在线底图',detail:matched?'OpenStreetMap底图 / OSRM道路规划 / 车辆轨迹预览':'测试点尚未完成道路规划'};
  }
  if(state.amapLoading)return{level:'warn',label:'地图连接中',detail:'当前为本地测试路线示意'};
  return{level:state.amapLoadError?'bad':'warn',label:'测试示意',detail:'本地测试路线示意，不代表真实道路匹配'};
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
function drawMatchedRoadRoute(path,source){
  if(!state.map||!window.L||!validRoadPath(path)||onlineMap.userLocal)return;
  clearRoadOverlays();state.localRouteId=state.current;state.roadPath=path;
  const fraction=driveExistingFraction(state.current,tNow().progress),route=routeNow();
  const outline=L.polyline(path.map(leafletPoint),{color:'#ffffff',weight:12,opacity:.96,interactive:false}).addTo(state.map);
  state.planPolyline=L.polyline(path.map(leafletPoint),{color:'#2476f3',weight:6,opacity:1,interactive:false}).addTo(state.map);
  state.donePolyline=L.polyline(localPathSlice(path,fraction).map(leafletPoint),{color:'#08b77a',weight:7,opacity:1,interactive:false}).addTo(state.map);
  state.donePolyline.setPath=function(points){this.setLatLngs(points.map(leafletPoint))};
  state.mapMarker=L.marker(leafletPoint(localPoint(path,fraction)),{icon:L.divIcon({className:'zls-leaflet-car',html:driveOnlineMarkerContent(),iconSize:[36,70],iconAnchor:[18,35]}),zIndexOffset:1000,interactive:false}).addTo(state.map);
  state.mapMarker.setPosition=function(point){this.setLatLng(leafletPoint(point))};
  state.localOverlays=[outline,state.planPolyline,state.donePolyline,state.mapMarker];
  const levels=['normal','warn','danger'];
  (route.eventFracs||[.3,.6,.82]).forEach((f,i)=>{
    const marker=L.marker(leafletPoint(localPoint(path,f)),{icon:L.divIcon({className:'zls-leaflet-event',html:eventMarkerContent(markerColor(levels[i]),esc(route.events[i]||'测试节点')),iconSize:[160,25],iconAnchor:[8,12]}),interactive:false,zIndexOffset:50}).addTo(state.map);
    state.localOverlays.push(marker);
  });
  onlineMap.routeStatus='matched';onlineMap.routeId=state.current;onlineMap.routeSource=source;
  state.amapLoadError='';showOnlineMapMode();
  setRoadRouteState('ok','在线道路规划完成',route.title+'｜车辆轨迹预览');
  requestAnimationFrame(()=>{if(state.localRouteId===state.current){fitCurrentRoadRoute();syncDriveMotion()}});
  updateOnlineMapInfo();
}
function updateRoadProgress(){syncDriveMotion()}
function routeAnchorPoints(route){
  const path=route.localPath||[],last=path.length-1;
  return [...new Set([0,Math.floor(last*.25),Math.floor(last*.5),Math.floor(last*.75),last])].map(i=>mapToWgs84(path[i]));
}
function requestRoadMatchedRoute(force=false){
  if(!state.map||!window.L||onlineMap.userLocal)return Promise.resolve();
  const id=state.current,route=routeLibrary[id],signature=roadSignature(id);
  if(!force&&state.localRouteId===id&&state.roadPath){showOnlineMapMode();return Promise.resolve()}
  const cache=readRoadCache(id);
  if(cache&&!force){drawMatchedRoadRoute(cache.path,'cache');return Promise.resolve()}
  if(onlineMap.inflight.has(id))return onlineMap.inflight.get(id);
  const last=onlineMap.attempts.get(id)||0;
  if(Date.now()-last<30000){if(force)toast('请稍后重试，避免重复请求');return Promise.resolve()}
  clearRoadOverlays();onlineMap.routeId=id;onlineMap.routeStatus='loading';updateOnlineMapInfo();
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
      if(state.current===id&&!onlineMap.userLocal){onlineMap.routeStatus='error';onlineMap.routeId=id;state.amapLoadError='道路规划暂不可用';enterStableLocalMapMode('道路规划暂不可用');applyLocalRoute(route,tNow().progress);updateOnlineMapInfo()}
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
  if(!mapOptions.enabled||!window.L){state.amapLoadError='地图组件不可用';onlineMap.failureUntil=Date.now()+30000;enterStableLocalMapMode();return}
  if(!navigator.onLine){state.amapLoadError='网络未连接';onlineMap.failureUntil=Date.now()+30000;enterStableLocalMapMode();return}
  initAmap();
  if(manual&&onlineMap.tiles&&!onlineMap.tileReady){onlineMap.batchOK=0;onlineMap.batchErrors=0;onlineMap.tiles.redraw()}
  if(state.map)requestRoadMatchedRoute(manual);
}
function initAmap(){
  if(!window.L||!mapPageIsVisible())return;
  if(state.map){state.map.resize();showOnlineMapMode();return}
  state.amapLoading=true;state.amapLoadError='';updateOnlineMapInfo();
  const route=routeNow();
  try{
    state.map=L.map('amap',{zoomControl:false,attributionControl:false,preferCanvas:false,maxZoom:19,minZoom:3});
    state.map.resize=()=>state.map.invalidateSize({pan:false,debounceMoveend:true});
    state.map.setView(leafletPoint(mapToWgs84(route.center)),Math.min(route.zoom,15));
    state.localOverlays=[];state.amapLoaded=true;
    state.map.on('click',()=>setDrawerExpanded(false));
    const tiles=L.tileLayer(mapOptions.tileUrl||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:0,referrerPolicy:'strict-origin-when-cross-origin'});
    onlineMap.tiles=tiles;
    const fail=()=>{onlineMap.tileReady=false;state.amapLoading=false;state.amapLoadError='在线底图加载失败';onlineMap.failureUntil=Date.now()+30000;enterStableLocalMapMode()};
    tiles.on('loading',()=>{onlineMap.batchOK=0;onlineMap.batchErrors=0;clearTimeout(onlineMap.tileTimer);onlineMap.tileTimer=setTimeout(()=>{if(!onlineMap.batchOK)fail()},15000)});
    tiles.on('tileload',()=>{onlineMap.batchOK++;onlineMap.tileReady=true;state.amapLoading=false;if(onlineMap.routeStatus!=='error')state.amapLoadError='';if(!onlineMap.userLocal&&onlineMap.routeStatus!=='error'){showOnlineMapMode();syncDriveMotion()}});
    tiles.on('tileerror',()=>{onlineMap.batchErrors++});
    tiles.on('load',()=>{clearTimeout(onlineMap.tileTimer);if(!onlineMap.batchOK&&onlineMap.batchErrors)fail();else{state.amapLoading=false;updateOnlineMapInfo()}});
    tiles.addTo(state.map);requestRoadMatchedRoute(false);
  }catch(error){state.amapLoading=false;state.amapLoaded=false;onlineMap.failureUntil=Date.now()+30000;state.amapLoadError='地图初始化失败';enterStableLocalMapMode()}
}
ensureOnlineMapInfo();
if($('mapLayers'))$('mapLayers').onclick=()=>{
  if(state.onlineMapVisible){onlineMap.userLocal=true;enterStableLocalMapMode();toast('已切换为本地测试路线示意')}
  else{onlineMap.userLocal=false;loadAmap(true)}
};
window.addEventListener('online',()=>{onlineMap.failureUntil=0;if(mapPageIsVisible()&&!onlineMap.userLocal)loadAmap(false)},{passive:true});
