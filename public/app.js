import {Camera,hasRange,readableError} from './camera.js';
import {enhance} from './image-service.js';
import {VERSION,readSettings,writeSettings} from './config.js';
import {savePhoto,listPhotos,getPhoto,deletePhoto} from './storage.js';

const $=id=>document.getElementById(id);
const settings=readSettings(),video=$('preview');
let screen='camera',busy=false,starting=false,startId=0,autoResume=true,current=null,lastShot=null,latestId=null,mode='enhanced';
let resultURLs=[],galleryURLs=[],thumbURL=null,toastTimer,focusTimer,zoomTimer,exposureTimer,previewSlow=0,lastCameraInfo=null,lastCapture=null;
let galleryFrom='camera',galleryGeneration=0,galleryOffset=0,installEvent=null,registration=null,wakeLock=null,updateRequested=false;
const camera=new Camera(video,()=>{
  if(screen==='camera'&&!busy){setCameraMessage('Kamera bağlantısı kesildi','Kamerayı yeniden başlatıyoruz…');setStatus('Bağlantı kesildi.');autoResume=true;
    setTimeout(()=>{if(screen==='camera'&&!document.hidden&&!busy&&!camera.active)startCamera();},600);}
});
$('version').textContent=VERSION;
const setStatus=text=>{$('cameraStatus').textContent=text;};
function toast(text){
  const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.hidden=true;},3800);
}
function revoke(urls){urls.forEach(u=>URL.revokeObjectURL(u));urls.length=0;}
function setCameraMessage(title,text,retry=false){
  $('cameraMessageTitle').textContent=title;$('cameraMessageText').textContent=text;
  $('cameraMessage').hidden=false;$('retry').hidden=!retry;
}
function progress(value,label){$('progress').value=value;$('progressLabel').textContent=label;}
function setBusy(value){
  busy=value;$('progressPanel').hidden=!value;
  $('shutter').disabled=value||!camera.active||starting;
  $('gallery').disabled=value;$('settings').disabled=value;
  $('switch').disabled=value||starting;$('torch').disabled=value;
  $('zoom').disabled=value;$('retry').disabled=value||starting;
}
async function acquireWakeLock(){
  if(wakeLock||!navigator.wakeLock||document.hidden||screen!=='camera'||!camera.active)return;
  try{const lock=await navigator.wakeLock.request('screen');
    if(document.hidden||screen!=='camera'||!camera.active){await lock.release();return;}
    wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});}catch{}
}
function releaseWakeLock(){const lock=wakeLock;wakeLock=null;lock?.release().catch(()=>{});}
function stopCamera(){
  startId++;starting=false;
  clearTimeout(zoomTimer);clearTimeout(exposureTimer);
  if(camera.active)lastCameraInfo=camera.info();
  camera.stop();releaseWakeLock();
  $('shutter').disabled=true;$('torch').hidden=true;$('zoomControl').hidden=true;$('resolutionBadge').hidden=true;
  $('exposureSetting').hidden=true;$('flashSetting').hidden=true;$('focusRing').hidden=true;
}
function updateCameraControls(){
  const c=camera.cap,p=camera.photoCap,active=camera.active;
  $('cameraMessage').hidden=!!active;$('resolutionBadge').hidden=!active;
  const w=video.videoWidth,h=video.videoHeight;
  $('resolutionBadge').textContent=w&&h?(w+' × '+h):'';
  $('shutter').disabled=!active||busy||starting;
  $('switch').hidden=!active||camera.devices.length<2;$('switch').disabled=busy||starting;
  $('torch').hidden=!active||!c.torch;$('torch').disabled=busy;$('torch').setAttribute('aria-pressed',String(camera.torchOn));
  $('torchText').textContent=camera.torchOn?'Açık':'Kapalı';
  $('zoomControl').hidden=!active||!hasRange(c.zoom);
  if(active&&hasRange(c.zoom)){const z=$('zoom');z.min=c.zoom.min;z.max=c.zoom.max;z.step=c.zoom.step>0?c.zoom.step:.1;z.value=camera.settings.zoom??c.zoom.min;$('zoomValue').textContent=Number(z.value).toFixed(1)+'×';}
  $('exposureSetting').hidden=!active||!hasRange(c.exposureCompensation);
  if(active&&hasRange(c.exposureCompensation)){
    const e=$('exposure'),r=c.exposureCompensation;e.min=r.min;e.max=r.max;e.step=r.step>0?r.step:.1;e.value=camera.settings.exposureCompensation??0;$('exposureValue').textContent=Number(e.value).toFixed(1)+' EV';
  }
  const flashModes=p.fillLightMode?.filter(v=>['auto','off','flash'].includes(v))||[];
  $('flashSetting').hidden=!active||!flashModes.length;
  $('flashMode').replaceChildren(...flashModes.map(v=>{const o=document.createElement('option');o.value=v;o.textContent={auto:'Otomatik',off:'Kapalı',flash:'Açık'}[v];return o;}));
  if(flashModes.length)$('flashMode').value=flashModes.includes(settings.flash)?settings.flash:flashModes[0];
  $('grid').hidden=!settings.grid||!active;
  $('modeBadge').lastChild.textContent=settings.profile==='faithful'?' ORİJİNALLİK':' PRO AUTO';
  if(active)lastCameraInfo=camera.info();
  if($('settingsDialog').open)diagnostics();
}
async function startCamera({retry=false,change=false}={}){
  if(screen!=='camera'||busy||starting||document.hidden)return;
  if(camera.active&&!change){updateCameraControls();return;}
  const id=++startId;starting=true;autoResume=true;setBusy(false);
  $('switch').disabled=true;$('shutter').disabled=true;
  setCameraMessage(change?'Kamera değiştiriliyor':'Kamera başlatılıyor',retry?'Kamera izni ve bağlantısı kontrol ediliyor.':'Kamera izni istendiğinde izin ver.');
  setStatus('Kamera hazırlanıyor…');
  try{
    if(change)await camera.switch();else await camera.start();
    if(id!==startId||document.hidden||screen!=='camera')return;
    starting=false;updateCameraControls();setStatus('Çekime hazır');acquireWakeLock();
  }catch(e){
    if(id!==startId)return;
    starting=false;
    if(camera.active){updateCameraControls();setStatus(e.message);acquireWakeLock();}
    else{autoResume=false;const [title,text]=readableError(e);setCameraMessage(title,text,true);setStatus('Kamera hazır değil');updateCameraControls();$('cameraMessage').hidden=false;releaseWakeLock();}
  }finally{if(id===startId){starting=false;setBusy(false);}}
}
function showScreen(name){
  screen=name;
  for(const type of ['camera','result','gallery'])$(type+'Screen').hidden=type!==name;
  if(name!=='camera')stopCamera();
  if(name!=='result'){
    $('enhancedImage').removeAttribute('src');$('originalImage').removeAttribute('src');revoke(resultURLs);
  }
  if(name!=='gallery'){galleryGeneration++;revoke(galleryURLs);$('galleryList').replaceChildren();}
  if(name==='camera'){
    setCameraMessage('Kamera başlatılıyor','Kamera hazırlanıyor…');
    setStatus('Hazırlanıyor…');autoResume=true;startCamera();
  }
}
function setThumb(record){
  if(thumbURL)URL.revokeObjectURL(thumbURL);thumbURL=null;
  const thumb=$('thumb');thumb.replaceChildren();
  if(record?.thumbnail){
    const img=document.createElement('img');img.alt='Son fotoğraf';thumbURL=URL.createObjectURL(record.thumbnail);img.src=thumbURL;thumb.append(img);
  }else{
    const span=document.createElement('span');span.textContent='▧';span.setAttribute('aria-hidden','true');span.style.fontSize='25px';thumb.append(span);
  }
}
async function refreshThumb(){try{const [latest]=await listPhotos(1);if(!lastShot){latestId=latest?.id||null;setThumb(latest);if(latest&&!lastCapture)lastCapture={...latest,method:latest.method,captureTime:latest.captureTime};}}catch{}}
function makeId(){return globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function actionName(record,original=false){
  const blob=original?record.original:record.enhanced;
  const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','image/avif':'avif'})[blob.type]||'img';
  const date=new Date(record.date),stamp=date.toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\.\d+Z$/,'');
  return 'TowCam-'+stamp+'-'+record.id.slice(0,8)+(original?'-original':'-pro')+'.'+ext;
}
function downloadPhoto(record,original=false){
  if(!record)return;const a=document.createElement('a');const url=URL.createObjectURL(original?record.original:record.enhanced);
  a.href=url;a.download=actionName(record,original);a.rel='noopener';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),45000);toast('İndirme isteği gönderildi. Tarayıcının indirmelerini kontrol et.');
}
async function doShare(){
  if(!current)return;
  const original=mode==='original',record=current,blob=original?record.original:record.enhanced;
  try{
    const file=new File([blob],actionName(record,original),{type:blob.type||'application/octet-stream',lastModified:record.date});
    if(navigator.share&&navigator.canShare?.({files:[file]})){
      await navigator.share({files:[file],title:'TowCam Pro'});return;
    }
    toast('Dosya paylaşımı desteklenmiyor; indirme isteği gönderiliyor.');downloadPhoto(record,original);
  }catch(e){if(e.name!=='AbortError'){toast('Paylaşım açılamadı; dosyayı indirebilirsin.');}}
}
async function archive(record){
  try{await savePhoto({...record,archived:true,archiveWarning:''});record.archived=true;return true;}
  catch{return false;}
}
async function capturePhoto(){
  if(busy||!camera.active||screen!=='camera')return;
  setBusy(true);progress(2,'Fotoğraf çekiliyor…');setStatus('Çekiliyor…');
  const start=performance.now();
  let original=null;
  try{
    const snap=await camera.take(settings);original=snap.blob;
    lastCameraInfo=camera.info();
    lastCapture={method:snap.method,reason:snap.reason,captureTime:snap.captureTime,light:snap.light};
    $('flashOverlay').hidden=false;setTimeout(()=>{$('flashOverlay').hidden=true;},100);
    stopCamera();progress(4,'Fotoğraf analiz ediliyor…');
    let data;
    try{data=await enhance(original,{profile:settings.profile,format:settings.format},progress);}
    catch(error){data={enhanced:original,thumbnail:original,width:0,height:0,profile:'Orijinal',engine:'Orijinal koruma',duration:0,protectedPixels:0,warning:'Fotoğraf işlenemedi; özgün dosya korunuyor.'};}
    const record={id:makeId(),date:Date.now(),original,enhanced:data.enhanced,thumbnail:data.thumbnail,width:data.width,height:data.height,profile:data.profile,engine:data.engine,duration:data.duration,protectedPixels:data.protectedPixels,stats:data.stats,warning:data.warning||'',method:snap.method,reason:snap.reason,captureTime:snap.captureTime,light:snap.light,totalTime:Math.round(performance.now()-start),archived:false};
    lastShot=current=record;latestId=record.id;lastCapture={...lastCapture,...{width:record.width,height:record.height,engine:record.engine,duration:record.duration,stats:record.stats,protectedPixels:record.protectedPixels,totalTime:record.totalTime}};
    setThumb(record);
    if(settings.autoArchive){progress(97,'Yerel arşiv kaydediliyor…');const ok=await archive(record);if(!ok)record.archiveWarning='Yerel arşiv kaydedilemedi; dosyayı indirmeyi unutma.';}
    showResult(record);if(settings.autoDownload)downloadPhoto(record);
  }catch(error){
    setStatus('Çekim tamamlanamadı.');
    toast(error.message||'Fotoğraf çekilemedi.');
    // If takePhoto is stuck, stopping the track safely releases the pending
    // capture before a new stream is opened.
    stopCamera();
    setCameraMessage('Çekim kesildi','Kamerayı tekrar başlat.',true);
  }finally{setBusy(false);}
}
function updateCompareFrame(){
  if(screen!=='result'||!current)return;
  const stage=$('compareStage'),frame=$('compareFrame'),img=$('enhancedImage');
  const w=current.width||img.naturalWidth,h=current.height||img.naturalHeight;
  if(!w||!h)return;
  const scale=Math.min(stage.clientWidth/w,stage.clientHeight/h);if(scale<=0)return;
  frame.style.width=Math.round(w*scale)+'px';frame.style.height=Math.round(h*scale)+'px';
}
function resultText(){
  const r=current;
  $('resultMeta').textContent=(r.width&&r.height?r.width+' × '+r.height+' · '+(r.width*r.height/1e6).toFixed(1)+' MP':'Çözünürlük okunamadı')+' · '+(r.duration? (r.duration/1000).toFixed(2)+' sn':'');
  $('resultNotice').textContent=[r.warning,r.archiveWarning,r.method?.includes('yedek')?'Video karesi kullanıldı.':r.reason,r.archived?'Orijinal ve işlenmiş dosya yerel arşivde.':'Orijinal dosya çekim sonucunda mevcut.'].filter(Boolean).join(' ');
  $('saveToArchive').hidden=!!r.archived;
}
function showResult(record){
  current=record;showScreen('result');revoke(resultURLs);
  const eu=URL.createObjectURL(record.enhanced),ou=URL.createObjectURL(record.original);resultURLs=[eu,ou];
  $('enhancedImage').src=eu;$('originalImage').src=ou;
  $('resultBadge').textContent=record.profile||'PRO AUTO';$('compare').value=50;
  setMode('enhanced');resultText();requestAnimationFrame(updateCompareFrame);
}
function setMode(value){
  mode=value;
  $('showEnhanced').setAttribute('aria-pressed',String(value==='enhanced'));
  $('showCompare').setAttribute('aria-pressed',String(value==='compare'));
  $('showOriginal').setAttribute('aria-pressed',String(value==='original'));
  $('originalImage').hidden=value==='enhanced';
  $('compareControl').hidden=value!=='compare';$('divider').hidden=value!=='compare';$('compareLabels').hidden=value!=='compare';$('resultBadge').hidden=value==='compare';
  $('resultBadge').textContent=value==='original'?'ORİJİNAL':current?.profile||'PRO AUTO';
  $('originalImage').style.clipPath=value==='original'?'none':'inset(0 '+(100-Number($('compare').value))+'% 0 0)';
  $('divider').style.left=$('compare').value+'%';
  $('download').lastChild.textContent=value==='original'?' Orijinali kaydet':' Kaydet';
}
function galleryCard(meta,container,generation,session=false){
  const card=document.createElement('article');card.className='gallery-card';
  const btn=document.createElement('button'),img=document.createElement('img'),text=document.createElement('div');
  img.alt='Fotoğraf önizlemesi';img.loading='lazy';img.decoding='async';
  if(meta.thumbnail){const url=URL.createObjectURL(meta.thumbnail);galleryURLs.push(url);img.src=url;}
  text.className='card-meta';text.textContent=(new Date(meta.date).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}))+(session?' · geçici':'')+' · '+(meta.profile||'PRO AUTO');
  btn.append(img,text);btn.setAttribute('aria-label','Fotoğrafı aç: '+text.textContent);
  btn.onclick=async()=>{try{const r=session?lastShot:await getPhoto(meta.id);if(generation!==galleryGeneration||screen!=='gallery')return;if(!r){toast('Fotoğraf artık arşivde yok.');renderGallery();return;}r.archived=!session;showResult(r);}catch{toast('Fotoğraf açılamadı.');}};
  const del=document.createElement('button');del.className='delete-btn';del.textContent='Sil';del.setAttribute('aria-label','Fotoğrafı arşivden sil: '+text.textContent);
  del.onclick=async()=>{if(!confirm('Bu fotoğrafın yerel arşivdeki orijinal ve işlenmiş kopyaları silinsin mi?'))return;try{if(!session)await deletePhoto(meta.id);if(current?.id===meta.id)current=null;if(lastShot?.id===meta.id)lastShot=null;await renderGallery();await refreshThumb();toast('Yerel kopyalar silindi.');}catch{toast('Fotoğraf silinemedi.');}};
  card.append(btn,del);container.append(card);
}
async function galleryPage(generation,append=false){
  const list=$('galleryList');let page=[];
  try{page=await listPhotos(31,galleryOffset);}catch{if(generation===galleryGeneration&&screen==='gallery')$('galleryEmpty').textContent='Yerel arşive erişilemedi. Bu tarayıcı depolamayı engelliyor olabilir.';}
  if(generation!==galleryGeneration||screen!=='gallery')return;
  if(!append&&lastShot&&!lastShot.archived)galleryCard(lastShot,list,generation,true);
  for(const m of page.slice(0,30))galleryCard(m,list,generation);
  $('galleryEmpty').hidden=list.children.length>0;
  if(page.length>30){
    const button=document.createElement('button');button.className='secondary full';button.textContent='Daha fazla göster';button.onclick=()=>{button.remove();galleryOffset+=30;galleryPage(generation,true);};list.append(button);
  }
}
async function renderGallery(){const generation=++galleryGeneration;revoke(galleryURLs);$('galleryList').replaceChildren();$('galleryEmpty').textContent='Henüz fotoğraf yok.';$('galleryEmpty').hidden=false;galleryOffset=0;await galleryPage(generation);}
function openGallery(){if(busy)return;galleryFrom=screen;showScreen('gallery');renderGallery();}
function diagnostics(){
  const info=camera.active?camera.info():lastCameraInfo;
  const yes=v=>v?'Var':'Yok';
  const lines=['TowCam Pro '+VERSION,'Tarayıcı: '+navigator.userAgent,'Güvenli bağlam: '+yes(window.isSecureContext),
    'MediaDevices: '+yes(navigator.mediaDevices?.getUserMedia),'ImageCapture API: '+yes(typeof ImageCapture==='function'),
    'Worker: '+yes(typeof Worker==='function')+' · OffscreenCanvas: '+yes(typeof OffscreenCanvas==='function'),
    'PWA: '+(matchMedia('(display-mode: standalone)').matches||navigator.standalone?'Bağımsız kurulum':'Tarayıcı'),
    'Service Worker: '+(navigator.serviceWorker?.controller?'Etkin':registration?'Kayıtlı, henüz kontrol etmiyor':'Etkin değil'),
    'Ağ: '+(navigator.onLine?'Çevrimiçi':'Çevrimdışı'),''];
  if(info)lines.push('Kamera: '+info.camera,'Yön: '+info.facing,'Önizleme: '+info.preview,'Bildirilen video üst sınırı: '+info.videoMax,
    'Bildirilen fotoğraf üst sınırı: '+info.photoMax,'Cihaz varsayılan fotoğrafı: '+info.defaultPhoto,
    'Kamera sayısı: '+info.devices,'Kare hızı: '+info.frameRate,'Açılış: '+info.startTime+' ms',
    'Torch: '+yes(info.torch),'Fotoğraf flaşı: '+info.flash,'Zoom: '+info.zoom,'Odak: '+info.focus,
    'Pozlama modu: '+info.exposure,'Pozlama telafisi: '+info.exposureCompensation,'Beyaz dengesi: '+info.whiteBalance,'');
  else lines.push('Kamera yetenekleri henüz ölçülmedi.','');
  if(lastCapture){
    const r=lastCapture;lines.push('Son çekim yöntemi: '+r.method,'Gerçek çıktı: '+(r.width&&r.height?r.width+' × '+r.height+' · '+(r.width*r.height/1e6).toFixed(2)+' MP':'Ölçülemedi'),
      'Çekim: '+r.captureTime+' ms','İşleme: '+(r.duration??'—')+' ms','Toplam: '+(r.totalTime??'—')+' ms','Motor: '+(r.engine||'—'),
      'Tam korunan çözülmüş piksel: '+(r.protectedPixels??'—')+' (JPEG kodlama öncesi)',r.reason||'');
    if(r.stats)lines.push('Ortalama parlaklık: '+r.stats.mean,'Histogram P05 / P50 / P95: '+r.stats.p05+' / '+r.stats.p50+' / '+r.stats.p95,
      'Gölge / aydınlık: '+Math.round(r.stats.shadows*100)+'% / '+Math.round(r.stats.highlights*100)+'%',
      'Kenar: '+r.stats.edge.toFixed(1)+' · Kumlanma göstergesi: '+r.stats.noise.toFixed(2),'Nötr renk sapması: '+r.stats.warmth);
  }
  lines.push('Not: bildirilen kapasite, gerçek fotoğraf çözünürlüğü değildir. Tarayıcı OEM kamera işlemlerinin tamamına erişemez.');
  $('diagText').textContent=lines.join('\n');
}

function bindSettings(){
  for(const [id,key] of Object.entries({quality:'quality',profile:'profile',format:'format',flashMode:'flash',gridSetting:'grid',previewSetting:'preview',autoArchive:'autoArchive',autoDownload:'autoDownload'})){
    const el=$(id);
    if(el.type==='checkbox')el.checked=settings[key];else if(id!=='flashMode')el.value=settings[key];
    el.addEventListener('change',()=>{settings[key]=el.type==='checkbox'?el.checked:el.value;writeSettings(settings);
      $('grid').hidden=!settings.grid||!camera.active;if(!settings.preview)video.style.filter='';previewSlow=0;
      $('modeBadge').lastChild.textContent=settings.profile==='faithful'?' ORİJİNALLİK':' PRO AUTO';
    });
  }
}
$('retry').onclick=()=>startCamera({retry:true});
$('shutter').onclick=capturePhoto;
$('switch').onclick=()=>startCamera({change:true});
$('torch').onclick=async()=>{if(busy||!camera.active)return;$('torch').disabled=true;try{await camera.toggleTorch();updateCameraControls();}catch(e){toast(e.message);}finally{$('torch').disabled=false;}};
$('zoom').oninput=()=>{const val=Number($('zoom').value);$('zoomValue').textContent=val.toFixed(1)+'×';clearTimeout(zoomTimer);
  const track=camera.track;zoomTimer=setTimeout(async()=>{if(track!==camera.track||busy)return;try{const actual=await camera.setControl('zoom',val);if(Number.isFinite(actual)){$('zoom').value=actual;$('zoomValue').textContent=actual.toFixed(1)+'×';}else{toast('Zoom değeri doğrulanamadı.');updateCameraControls();}}catch{toast('Zoom uygulanamadı.');updateCameraControls();}},120);};
$('exposure').oninput=()=>{const val=Number($('exposure').value);$('exposureValue').textContent=val.toFixed(1)+' EV';clearTimeout(exposureTimer);
  const track=camera.track;exposureTimer=setTimeout(async()=>{if(track!==camera.track||busy)return;try{const actual=await camera.setControl('exposureCompensation',val);if(Number.isFinite(actual)){$('exposure').value=actual;$('exposureValue').textContent=actual.toFixed(1)+' EV';}else{toast('Pozlama değeri doğrulanamadı.');updateCameraControls();}}catch{toast('Pozlama uygulanamadı.');updateCameraControls();}},120);};
$('viewfinder').addEventListener('click',async e=>{
  if(e.target!==video||busy||!camera.active||!camera.cap.focusMode?.includes('single-shot'))return;
  try{
    const support=navigator.mediaDevices.getSupportedConstraints?.()||{},rect=video.getBoundingClientRect();
    const scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale;
    const x=(e.clientX-rect.left-(rect.width-vw)/2)/vw,y=(e.clientY-rect.top-(rect.height-vh)/2)/vh;
    if(x<0||x>1||y<0||y>1)return;
    if(support.pointsOfInterest){
      await camera.setFocus(x,y);
      const vr=$('viewfinder').getBoundingClientRect();$('focusRing').style.left=(e.clientX-vr.left)+'px';$('focusRing').style.top=(e.clientY-vr.top)+'px';$('focusRing').hidden=false;clearTimeout(focusTimer);focusTimer=setTimeout(()=>{$('focusRing').hidden=true;},850);
    }else{await camera.setControl('focusMode','single-shot');toast('Tek seferlik odak isteği gönderildi.');}
  }catch{toast('Odaklama kontrolü uygulanamadı.');}
});
$('settings').onclick=()=>{diagnostics();$('settingsDialog').showModal();};
$('closeSettings').onclick=()=>$('settingsDialog').close();
$('settingsDialog').addEventListener('close',()=>{if(screen==='camera'&&camera.active)acquireWakeLock();});
$('diagnostics').addEventListener('toggle',()=>{if($('diagnostics').open)diagnostics();});
$('selfTest').onclick=async()=>{
  const button=$('selfTest'),out=$('selfTestOutput');if(button.disabled)return;
  button.disabled=true;out.hidden=false;out.textContent='Sentetik öz test çalışıyor; kamera veya kişisel fotoğraf kullanılmaz.\n';
  try{const {runSelfTest}=await import('./selftest.js');const result=await runSelfTest(line=>{out.textContent+='\n'+line+'\n';});out.textContent+='\nSONUÇ: '+result.pass+' başarılı, '+result.fail+' başarısız.';}
  catch(error){out.textContent+='\nÖz test başlatılamadı: '+error.message;}
  finally{button.disabled=false;}
};
$('copyDiag').onclick=async()=>{diagnostics();try{await navigator.clipboard.writeText($('diagText').textContent);toast('Teşhis kopyalandı.');}catch{const range=document.createRange();range.selectNodeContents($('diagText'));getSelection()?.removeAllRanges();getSelection()?.addRange(range);toast('Metin seçildi; kopyalayabilirsin.');}};
$('gallery').onclick=openGallery;$('resultGallery').onclick=openGallery;
$('galleryBack').onclick=()=>{if(galleryFrom==='result'&&current)showResult(current);else showScreen('camera');};
$('backCamera').onclick=()=>showScreen('camera');
$('showEnhanced').onclick=()=>setMode('enhanced');$('showCompare').onclick=()=>setMode('compare');$('showOriginal').onclick=()=>setMode('original');
$('compare').oninput=()=>setMode('compare');
$('download').onclick=()=>downloadPhoto(current,mode==='original');
$('downloadOriginal').onclick=()=>downloadPhoto(current,true);
$('share').onclick=doShare;
$('saveToArchive').onclick=async()=>{if(!current)return;const record=current;$('saveToArchive').disabled=true;const ok=await archive(record);if(ok){record.archiveWarning='';toast('Yerel arşive kaydedildi.');}else toast('Yerel arşiv kaydedilemedi. Dosyayı indir.');if(current===record)resultText();$('saveToArchive').disabled=false;};
$('enhancedImage').onload=updateCompareFrame;
window.addEventListener('resize',updateCompareFrame);
if(typeof ResizeObserver==='function')new ResizeObserver(updateCompareFrame).observe($('compareStage'));
video.addEventListener('resize',()=>{if(camera.active){$('resolutionBadge').textContent=video.videoWidth+' × '+video.videoHeight;}});
setInterval(()=>{
  if(!settings.preview||screen!=='camera'||document.hidden||!camera.active||busy||starting||$('settingsDialog').open){video.style.filter='';return;}
  if(previewSlow>=3)return;
  const t=performance.now(),light=camera.light;if(light===null)return;
  const strength=settings.profile==='faithful'?.38:1;
  const bright=1+Math.min(.13,Math.max(0,(110-light)/500))*strength;
  const contrast=1+(light>100?.025:.008)*strength;
  video.style.filter='brightness('+bright.toFixed(3)+') contrast('+contrast.toFixed(3)+') saturate('+(1+.025*strength)+')';
  if(performance.now()-t>30){previewSlow++;if(previewSlow>=3)video.style.filter='';}
},1800);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){autoResume=autoResume||camera.active||starting;stopCamera();}
  else{if(screen==='camera'&&!busy&&autoResume)startCamera();registration?.update().catch(()=>{});}
});
window.addEventListener('pagehide',()=>stopCamera());
window.addEventListener('pageshow',e=>{if(e.persisted&&screen==='camera'&&!busy){autoResume=true;startCamera();}});
navigator.mediaDevices?.addEventListener?.('devicechange',()=>{if(screen==='camera'&&!busy&&!camera.active&&autoResume&&!document.hidden)startCamera();});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('install').hidden=false;});
async function install(){
  if(!installEvent){$('installHint').hidden=false;return;}
  const event=installEvent;installEvent=null;$('install').hidden=true;
  try{await event.prompt();await event.userChoice;}catch{$('installHint').hidden=false;}
}
$('install').onclick=install;$('installHelp').onclick=install;
window.addEventListener('appinstalled',()=>{installEvent=null;$('install').hidden=true;toast('Uygulama kuruldu.');});
function updateAvailable(){if(registration?.waiting&&navigator.serviceWorker.controller){$('update').hidden=false;toast('Yeni sürüm hazır. Ayarlardan güvenle güncelleyebilirsin.');}}
async function registerPWA(){
  if(!('serviceWorker' in navigator))return;
  let controlled=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(controlled&&updateRequested)location.reload();controlled=true;});
  try{
    registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    updateAvailable();
    registration.addEventListener('updatefound',()=>{registration.installing?.addEventListener('statechange',updateAvailable);});
    registration.update().catch(()=>{});
    setInterval(()=>{if(!document.hidden&&!busy)registration?.update().catch(()=>{});},900000);
  }catch{console.warn('Çevrimdışı kurulum desteklenmiyor veya kayıt başarısız.');}
}
$('update').onclick=()=>{if(registration?.waiting&&!busy){updateRequested=true;stopCamera();registration.waiting.postMessage({type:'ACTIVATE'});}};
bindSettings();refreshThumb();registerPWA();startCamera();
