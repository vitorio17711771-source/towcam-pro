import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png'};
let updated=false;
const serversErrors=[];
const csp=(await readFile(resolve(root,'_headers'),'utf8')).split('\n').find(l=>l.includes('Content-Security-Policy:')).trim().split(': ').slice(1).join(': ');
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
    res.setHeader('Content-Security-Policy',csp);
    res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cache-Control','no-cache');
    if(pathname==='/test-harness'){res.setHeader('Content-Type','text/html');res.end('<html><title>Local test harness</title><body>test</body></html>');return;}
    const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!path.startsWith(root)||!(await stat(path)).isFile()){res.writeHead(404);res.end('Not found');return;}
    let content=await readFile(path);
    if(updated&&pathname==='/sw.js')content=Buffer.from(content.toString().replace('towcam-pro-1.0.0','towcam-pro-1.0.0-test'));
    res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');
    res.end(content);
  }catch(e){res.writeHead(404);res.end('Not found');if(!['ENOENT','ENOTDIR'].includes(e.code))serversErrors.push(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
let pass=0,fail=0;const issues=[],measurements={};
async function check(name,fn){const t=Date.now();try{await fn();pass++;console.log('PASS',name,Date.now()-t+'ms');}catch(e){fail++;console.log('FAIL',name,e.stack||e);issues.push({name,error:e.message});}}
const newContext=async(extra={})=>browser.newContext({viewport:{width:412,height:892},isMobile:true,hasTouch:true,deviceScaleFactor:2,acceptDownloads:true,permissions:['camera'],...extra});
const context=await newContext();
const page=await context.newPage();
const pageErrors=[],outbound=[];
page.on('pageerror',e=>pageErrors.push(e.message));
page.on('request',r=>{const u=r.url();if(!u.startsWith(base)&&!u.startsWith('blob:')&&!u.startsWith('data:'))outbound.push(u);if(!['GET','HEAD'].includes(r.method()))outbound.push(r.method()+' '+u);});
const ready=()=>page.waitForFunction(()=>!document.getElementById('shutter').disabled,{},{timeout:25000});
const capture=async()=>{await page.locator('#shutter').click();await page.locator('#resultScreen').waitFor({state:'visible',timeout:120000});};
const cameraBack=async()=>{await page.locator('#backCamera').click();await ready();};
const benchContext=await newContext(),bench=await benchContext.newPage();
try{
await check('Anonim mobil açılış ve gerçek tarayıcı medya akışı (sentetik donanım)',async()=>{
  const start=Date.now();const response=await page.goto(base);assert.equal(response.status(),200);await ready();measurements.cameraReadyMs=Date.now()-start;
  assert.ok(await page.locator('#preview').evaluate(v=>v.videoWidth>0&&v.videoHeight>0));assert.equal(await page.locator('#cameraMessage').isHidden(),true);
  const counts=await page.evaluate(()=>({w:document.querySelector('#preview').videoWidth,h:document.querySelector('#preview').videoHeight,secure:isSecureContext,body:document.body.scrollWidth,view:innerWidth}));
  measurements.preview=counts.w+'x'+counts.h;assert.ok(counts.secure);assert.ok(counts.body<=counts.view+1);
  if(process.env.SCREENSHOTS)await page.screenshot({path:process.env.SCREENSHOTS+'/camera.png'});
});
await check('Desteklenmeyen özellikler gizli; teşhis ve ayarlar çalışıyor',async()=>{
  await page.locator('#settings').click();
  await page.locator('#diagnostics summary').click();
  const text=await page.locator('#diagText').innerText();assert.match(text,/ImageCapture API:/);assert.match(text,/Bildirilen fotoğraf üst sınırı:/);
  assert.match(text,/Önizleme: \d+ × \d+/);
  await page.locator('#gridSetting').check();await page.locator('#closeSettings').click();assert.equal(await page.locator('#grid').isVisible(),true);
  await page.locator('#settings').click();await page.locator('#gridSetting').uncheck();await page.locator('#closeSettings').click();
  assert.equal(await page.locator('#grid').isHidden(),true);
});
await check('Çekim, otomatik işleme, gerçek ölçüler ve orijinal/sonuç gösterimi',async()=>{
  const start=Date.now();await capture();measurements.firstCaptureMs=Date.now()-start;
  await page.locator('#enhancedImage').evaluate(i=>i.decode());
  assert.match(await page.locator('#resultMeta').innerText(),/\d+ × \d+ · \d/);
  assert.match(await page.locator('#resultNotice').innerText(),/yerel arşivde/);
  const sizes=await page.evaluate(async()=>{const a=document.querySelector('#enhancedImage'),b=document.querySelector('#originalImage');await b.decode();return [a.naturalWidth,a.naturalHeight,b.naturalWidth,b.naturalHeight];});
  assert.equal(sizes[0],sizes[2]);assert.equal(sizes[1],sizes[3]);measurements.actualPhoto=sizes[0]+'x'+sizes[1];
  await page.locator('#showCompare').click();assert.equal(await page.locator('#compareControl').isVisible(),true);
  await page.locator('#compare').fill('22');assert.match(await page.locator('#originalImage').evaluate(i=>i.style.clipPath),/78%/);
  await page.locator('#showOriginal').click();assert.equal(await page.locator('#originalImage').evaluate(i=>i.style.clipPath),'none');
  await page.locator('#showEnhanced').click();assert.equal(await page.locator('#originalImage').isHidden(),true);
  if(process.env.SCREENSHOTS)await page.screenshot({path:process.env.SCREENSHOTS+'/result.png'});
});
await check('Orijinal ve işlenmiş dosya indirme, byte-a-byte özgün dosya',async()=>{
  const original=await page.evaluate(async()=>{const b=await (await fetch(document.querySelector('#originalImage').src)).arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');});
  const [d]=await Promise.all([page.waitForEvent('download'),page.locator('#downloadOriginal').click()]);assert.match(d.suggestedFilename(),/-original\./);
  const {createHash}=await import('node:crypto');const path=await d.path();assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),original);
  const [d2]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);assert.match(d2.suggestedFilename(),/-pro\./);assert.ok((await stat(await d2.path())).size>0);
});
await check('Dosya paylaşımı: desteklenen Web Share API çağrısı (taklit paylaşım hedefi)',async()=>{
  await page.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:o=>o.files?.length===1});Object.defineProperty(navigator,'share',{configurable:true,value:async o=>{window.shareProof={name:o.files[0].name,size:o.files[0].size,type:o.files[0].type};}});});
  await page.locator('#share').click();await page.waitForFunction(()=>window.shareProof?.size>0);const share=await page.evaluate(()=>window.shareProof);assert.match(share.name,/-pro\./);
});
await check('Yerel arşiv, sekme yeniden açılması ve fotoğrafa erişim',async()=>{
  await page.reload();await ready();await page.locator('#gallery').click();await page.locator('.gallery-card').first().waitFor({state:'visible'});
  assert.equal(await page.locator('.gallery-card').count(),1);await page.locator('.gallery-card button').first().click();await page.locator('#resultScreen').waitFor();
  assert.equal(await page.locator('#saveToArchive').isHidden(),true);
});
await check('Seri çekimler ve kaynakların sonuçta serbest kalması',async()=>{
  const timings=[];for(let i=0;i<3;i++){await cameraBack();const start=Date.now();await capture();timings.push(Date.now()-start);assert.equal(await page.locator('#preview').evaluate(v=>v.srcObject),null);}
  measurements.serialCaptureMs=timings;
  await page.locator('#resultGallery').click();await page.locator('.gallery-card').first().waitFor();assert.equal(await page.locator('.gallery-card').count(),4);
  await page.locator('#galleryBack').click();await page.locator('#resultScreen').waitFor();await cameraBack();
});
await check('İzin reddi ve başarılı tekrar deneme (API hata simülasyonu)',async()=>{
  const c=await newContext();const p=await c.newPage();
  await p.addInitScript(()=>{const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.denyCamera=true;navigator.mediaDevices.getUserMedia=async(...a)=>{if(window.denyCamera)throw new DOMException('Denied','NotAllowedError');return gum(...a);};});
  await p.goto(base);await p.locator('#retry').waitFor({state:'visible'});assert.match(await p.locator('#cameraMessageTitle').innerText(),/izni/i);assert.equal(await p.locator('#shutter').isDisabled(),true);
  await p.evaluate(()=>window.denyCamera=false);await p.locator('#retry').click();await p.waitForFunction(()=>!document.getElementById('shutter').disabled,{}, {timeout:25000});await c.close();
});
await check('Bağlantı kesilmesi sonrası otomatik kurtarma',async()=>{
  await page.evaluate(()=>{const track=document.querySelector('#preview').srcObject.getVideoTracks()[0];track.stop();track.dispatchEvent(new Event('ended'));});
  await page.waitForFunction(()=>!document.querySelector('#shutter').disabled&&document.querySelector('#preview').srcObject?.getVideoTracks()[0].readyState==='live',{}, {timeout:25000});
});
await check('ImageCapture bulunmadığında yedek video karesi ve gerçek çıktı',async()=>{
  const c=await newContext(),p=await c.newPage();await p.addInitScript(()=>Object.defineProperty(window,'ImageCapture',{configurable:true,value:undefined}));
  await p.goto(base);await p.waitForFunction(()=>!document.querySelector('#shutter').disabled,{}, {timeout:25000});await p.locator('#shutter').click();await p.locator('#resultScreen').waitFor({timeout:120000});
  assert.match(await p.locator('#resultNotice').innerText(),/Video karesi/);await c.close();
});
await check('Ön/arka kamera geçişi, torch ve zoom (iki kamera yetenek simülasyonu)',async()=>{
  const c=await newContext(),p=await c.newPage();
  await p.addInitScript(()=>{
    const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'rear',label:'Rear'},{kind:'videoinput',deviceId:'front',label:'Front'}];
    navigator.mediaDevices.getUserMedia=async args=>{
      const facing=args.video?.facingMode?.exact||args.video?.facingMode?.ideal||'environment';
      const st=await gum({audio:false,video:true});const t=st.getVideoTracks()[0],settings=t.getSettings.bind(t),caps=t.getCapabilities.bind(t);let zoom=1,torch=false;
      t.getSettings=()=>({...settings(),facingMode:facing,zoom,torch});
      t.getCapabilities=()=>({...caps(),torch:true,zoom:{min:1,max:4,step:.1}});
      t.applyConstraints=async v=>{if(v.advanced?.[0]?.zoom!=null)zoom=v.advanced[0].zoom;if(v.advanced?.[0]?.torch!=null)torch=v.advanced[0].torch;};
      return st;
    };
  });
  await p.goto(base);await p.waitForFunction(()=>!document.querySelector('#shutter').disabled,{}, {timeout:25000});
  assert.equal(await p.locator('#switch').isVisible(),true);await p.locator('#torch').click();await p.waitForFunction(()=>document.querySelector('#torch').getAttribute('aria-pressed')==='true');
  await p.locator('#zoom').fill('2.5');await p.waitForFunction(()=>document.querySelector('#preview').srcObject.getVideoTracks()[0].getSettings().zoom===2.5);
  await p.locator('#switch').click();await p.waitForFunction(()=>!document.querySelector('#shutter').disabled&&document.querySelector('#preview').srcObject.getVideoTracks()[0].getSettings().facingMode==='user',{}, {timeout:25000});
  await p.locator('#switch').click();await p.waitForFunction(()=>!document.querySelector('#shutter').disabled&&document.querySelector('#preview').srcObject.getVideoTracks()[0].getSettings().facingMode==='environment',{}, {timeout:25000});await c.close();
});
await check('Ayrı anonim kullanıcı bağlamında arşiv yalıtımı',async()=>{
  const c=await newContext(),p=await c.newPage();await p.goto(base);await p.waitForFunction(()=>!document.querySelector('#shutter').disabled,{}, {timeout:25000});
  await p.locator('#gallery').click();await p.waitForTimeout(300);assert.equal(await p.locator('.gallery-card').count(),0);assert.match(await p.locator('#galleryEmpty').innerText(),/Henüz fotoğraf yok/);await c.close();
});
await check('PWA manifest, gerçek ikon boyutları, Service Worker önbelleği',async()=>{
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{}, {timeout:20000});
  const info=await page.evaluate(async()=>{
    const m=await(await fetch('/manifest.webmanifest')).json();
    const icons=await Promise.all(m.icons.map(async i=>{const im=new Image();im.src=i.src;await im.decode();return [im.naturalWidth,im.naturalHeight,i.purpose];}));
    const ks=await caches.keys(),c=await caches.open('towcam-pro-1.0.0');return {m,icons,ks,assets:(await c.keys()).length};
  });
  assert.equal(info.m.display,'standalone');assert.deepEqual(info.icons,[[192,192,'any'],[512,512,'any'],[512,512,'maskable']]);assert.ok(info.assets>=15);assert.ok(info.ks.includes('towcam-pro-1.0.0'));
  const cdp=await context.newCDPSession(page);try{measurements.installability=await cdp.send('Page.getInstallabilityErrors');}catch{measurements.installability='CDP bu sürümde raporlamadı';}
});
await check('Yeni Service Worker güncellemesi ve önceki cache temizliği',async()=>{
  updated=true;
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting,{}, {timeout:30000});
  await page.locator('#settings').click();await page.locator('#update').waitFor({state:'visible'});await Promise.all([page.waitForNavigation({timeout:30000}),page.locator('#update').click()]);
  await ready();await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('towcam-pro-1.0.0-test')&&!keys.includes('towcam-pro-1.0.0');},{},{timeout:25000});
});
await check('Çevrimdışı yeniden açılış, kamera, işleme ve arşiv',async()=>{
  await context.setOffline(true);await page.reload();await ready();await capture();assert.match(await page.locator('#resultNotice').innerText(),/yerel arşivde/);await context.setOffline(false);
});
await check('Yerel arşivden silme (iki dosya birlikte)',async()=>{
  await page.locator('#resultGallery').click();await page.locator('.gallery-card').first().waitFor();const count=await page.locator('.gallery-card').count();
  page.once('dialog',d=>d.accept());await page.locator('.gallery-card .delete-btn').first().click();
  await page.waitForFunction(n=>document.querySelectorAll('.gallery-card').length===n-1,count,{timeout:15000});
  assert.equal(await page.locator('.gallery-card').count(),count-1);await page.locator('#galleryBack').click();await ready();
});
await check('Yatay mobil arayüz ve taşma kontrolü',async()=>{
  await page.setViewportSize({width:892,height:412});await page.waitForTimeout(200);assert.equal(await page.locator('#shutter').isVisible(),true);
  assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1));const box=await page.locator('#shutter').boundingBox();assert.ok(box.y+box.height<=412);
  await page.setViewportSize({width:360,height:740});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1));
});
await check('Tarayıcı hataları veya fotoğrafı ağ üzerinden gönderen istek yok',async()=>{assert.deepEqual(pageErrors,[]);assert.deepEqual(outbound,[]);assert.deepEqual(serversErrors,[]);});
await bench.goto(base+'/test-harness');
await check('EXIF orientation 6: gerçek yön ve çözünürlük korunur',async()=>{
  const b64=(await readFile(new URL('./fixtures/orientation6.jpg',import.meta.url))).toString('base64');
  const r=await bench.evaluate(async b64=>{const {processPhoto}=await import('/processor.js');const b=new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/jpeg'});const out=await processPhoto(b,{format:'png'});const im=await createImageBitmap(out.enhanced);return {w:out.width,h:out.height,iw:im.width,ih:im.height,type:out.enhanced.type};},b64);
  assert.deepEqual(r,{w:48,h:80,iw:48,ih:80,type:'image/png'});
});
await check('Sentetik Türkçe yazı, plaka, telefon ve logo; PNG güçlü kenar koruma',async()=>{
  const r=await bench.evaluate(async()=>{
    const {processPhoto}=await import('/processor.js');const c=document.createElement('canvas');c.width=960;c.height=540;const g=c.getContext('2d',{willReadFrequently:true});g.fillStyle='#737878';g.fillRect(0,0,960,540);g.fillStyle='#18222c';g.fillRect(100,120,760,240);g.fillStyle='#e9e9df';g.fillRect(270,243,420,66);
    g.fillStyle='#101010';g.font='bold 44px sans-serif';g.fillText('34 TOW 2026',295,292);g.fillStyle='#f8e8b9';g.font='bold 36px sans-serif';g.fillText('ÇEKİCİ  ŞĞÜÖİ',140,173);g.font='25px sans-serif';g.fillText('0555 123 45 67',140,204);
    g.strokeStyle='#f1bd60';g.lineWidth=7;g.strokeRect(725,146,100,80);g.fillStyle='#f1bd60';g.fillRect(757,170,35,35);
    const input=g.getImageData(0,0,960,540).data;
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));const out=await processPhoto(blob,{format:'png'});
    const bmp=await createImageBitmap(out.enhanced);g.clearRect(0,0,960,540);g.drawImage(bmp,0,0);bmp.close();const output=g.getImageData(0,0,960,540).data;
    let edges=0,exact=0;const L=(i)=>.2126*input[i]+.7152*input[i+1]+.0722*input[i+2];
    for(let y=1;y<539;y++)for(let x=1;x<959;x++){let i=(y*960+x)*4,l=L(i),delta=Math.max(Math.abs(l-L(i-4)),Math.abs(l-L(i+4)),Math.abs(l-L(i-3840)),Math.abs(l-L(i+3840)));if(delta>=46){edges++;if(input[i]===output[i]&&input[i+1]===output[i+1]&&input[i+2]===output[i+2])exact++;}}
    return {width:out.width,height:out.height,edges,exact,protected:out.protectedPixels};
  });measurements.textEdges=r;assert.equal(r.width,960);assert.equal(r.height,540);assert.ok(r.edges>1000);assert.equal(r.exact,r.edges);
});
await check('JPEG ve PNG tam boyut, 12 MP ölçümü ve Worker',async()=>{
  const result=await bench.evaluate(async()=>{
    const {enhance}=await import('/image-service.js');const c=document.createElement('canvas');c.width=4000;c.height=3000;const g=c.getContext('2d');const gr=g.createLinearGradient(0,0,4000,3000);gr.addColorStop(0,'#272b2e');gr.addColorStop(1,'#d9cbbb');g.fillStyle=gr;g.fillRect(0,0,4000,3000);g.fillStyle='#eeeeee';g.font='bold 160px sans-serif';g.fillText('34 TOW 2026',800,1400);
    const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.98));c.width=c.height=1;
    const out=await enhance(b,{format:'jpeg'},()=>{});const bmp=await createImageBitmap(out.enhanced);const result={w:out.width,h:out.height,iw:bmp.width,ih:bmp.height,duration:out.duration,engine:out.engine,type:out.enhanced.type,bytes:out.enhanced.size};bmp.close();return result;
  });measurements.twelveMP=result;assert.equal(result.w,4000);assert.equal(result.h,3000);assert.equal(result.iw,4000);assert.equal(result.ih,3000);assert.equal(result.type,'image/jpeg');assert.match(result.engine,/Worker/);
});
await check('50 MP yüksek çözünürlük: ölç, boyutu düşürme',async()=>{
  const result=await bench.evaluate(async()=>{
    const {enhance}=await import('/image-service.js');const c=document.createElement('canvas');c.width=8160;c.height=6120;const g=c.getContext('2d');const gr=g.createLinearGradient(0,0,8160,6120);gr.addColorStop(0,'#3b4142');gr.addColorStop(1,'#b9bfc1');g.fillStyle=gr;g.fillRect(0,0,8160,6120);g.fillStyle='#eeeeee';g.font='bold 260px sans-serif';g.fillText('TOWCAM PRO',2000,3000);
    const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.97));c.width=c.height=1;const out=await enhance(b,{format:'jpeg'},()=>{});const im=await createImageBitmap(out.enhanced);
    const result={w:out.width,h:out.height,iw:im.width,ih:im.height,duration:out.duration,engine:out.engine,type:out.enhanced.type,bytes:out.enhanced.size,warning:out.warning||''};im.close();return result;
  });measurements.fiftyMP=result;assert.equal(result.w,8160);assert.equal(result.h,6120);assert.equal(result.iw,8160);assert.equal(result.ih,6120);assert.match(result.engine,/Worker/);
});
await check('Worker yoksa ana iş parçacığında parçalı işleme',async()=>{
  const result=await bench.evaluate(async()=>{
    const {enhance}=await import('/image-service.js');const original=window.Worker;window.Worker=undefined;
    try{const c=document.createElement('canvas');c.width=93;c.height=77;const ctx=c.getContext('2d');ctx.fillStyle='#343b43';ctx.fillRect(0,0,93,77);const blob=await new Promise(r=>c.toBlob(r));const o=await enhance(blob,{format:'png'},()=>{});return {w:o.width,h:o.height,engine:o.engine,type:o.enhanced.type};}finally{window.Worker=original;}
  });assert.deepEqual(result,{w:93,h:77,engine:'Parçalı Canvas · RGB',type:'image/png'});
});
}finally{
  await browser.close();await new Promise(r=>server.close(r));
  console.log(JSON.stringify({pass,fail,measurements,issues},null,2));if(fail)process.exitCode=1;
}
