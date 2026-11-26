import {enhance} from './image-service.js';
import {verifyArchiveRollback} from './storage.js';
import {VERSION} from './config.js';
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const asBlob=(c,type)=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Sentetik kodlama başarısız.')),type,.98));
async function asImage(blob){
  if(typeof createImageBitmap==='function'){try{return await createImageBitmap(blob,{imageOrientation:'from-image'});}catch{}}
  const url=URL.createObjectURL(blob);try{const i=new Image();i.src=url;await i.decode();return i;}finally{URL.revokeObjectURL(url);}
}
const hash=async blob=>{
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
  return Array.from(a,v=>v.toString(16).padStart(2,'0')).join('');
};
async function testPixels(){
  const w=1200,h=800,c=makeCanvas(w,h),g=c.getContext('2d',{willReadFrequently:true});
  const grad=g.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#282e34');grad.addColorStop(1,'#c9beb5');
  g.fillStyle=grad;g.fillRect(0,0,w,h);
  g.fillStyle='#18222c';g.fillRect(130,175,940,440);
  g.fillStyle='#e8e8df';g.fillRect(360,460,480,88);g.fillStyle='#111';g.font='bold 52px sans-serif';g.fillText('34 TOW 2026',385,522);
  g.fillStyle='#f9e8b6';g.font='bold 40px sans-serif';g.fillText('ÇEKİCİ  ŞĞÜÖİ',185,270);
  g.font='30px sans-serif';g.fillText('0555 123 45 67',185,327);
  g.fillStyle='#f4be65';g.strokeStyle='#f4be65';g.lineWidth=7;g.strokeRect(910,240,110,95);g.fillRect(945,267,40,40);
  const before=g.getImageData(0,0,w,h).data,b=await asBlob(c,'image/png'),sha=await hash(b);
  const r=await enhance(b,{format:'png',profile:'auto'},()=>{});
  if(r.warning||r.engine==='Orijinal koruma')throw new Error(r.warning||'İşleme motoru çalışmadı.');
  const image=await asImage(r.enhanced),iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;
  if(iw!==w||ih!==h||r.width!==w||r.height!==h||r.enhanced.type!=='image/png')throw new Error('Çıktı boyutu veya biçimi değişti.');
  g.clearRect(0,0,w,h);g.drawImage(image,0,0);image.close?.();
  const after=g.getImageData(0,0,w,h).data;
  const L=i=>.2126*before[i]+.7152*before[i+1]+.0722*before[i+2];
  let edges=0,exact=0,changed=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=(y*w+x)*4,l=L(i),delta=Math.max(Math.abs(l-L(i-4)),Math.abs(l-L(i+4)),Math.abs(l-L(i-w*4)),Math.abs(l-L(i+w*4)));
    const same=before[i]===after[i]&&before[i+1]===after[i+1]&&before[i+2]===after[i+2];
    if(!same)changed++;
    if(delta>=46){edges++;if(same)exact++;}
  }
  if(edges<1000||exact!==edges||changed===0||sha!==await hash(b))throw new Error('Piksel / özgün dosya kontrolü başarısız.');
  c.width=c.height=1;
  return {message:w+' × '+h+' · '+r.engine+' · '+r.duration+' ms\n'+exact+' / '+edges+' güçlü kenar pikseli birebir, '+changed+' diğer piksel değişti. Özgün SHA-256 aynı.',sample:b};
}
async function testOrientation(){
  const c=makeCanvas(80,48),g=c.getContext('2d');g.fillStyle='#b7ad99';g.fillRect(0,0,80,48);g.fillStyle='#c93131';g.fillRect(0,0,20,10);
  const b=await asBlob(c,'image/jpeg');c.width=c.height=1;
  // Synthetic APP1 EXIF: little-endian TIFF with a single Orientation=6 tag.
  const exif=new Uint8Array([0xff,0xe1,0x00,0x22,0x45,0x78,0x69,0x66,0,0,0x49,0x49,0x2a,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const tagged=new Blob([b.slice(0,2),exif,b.slice(2)],{type:'image/jpeg'});
  const r=await enhance(tagged,{format:'png'},()=>{});
  if(r.warning||r.width!==48||r.height!==80)throw new Error('EXIF yön testi: beklenen 48 × 80, alınan '+r.width+' × '+r.height);
  return 'EXIF Orientation 6: 80 × 48 → 48 × 80, kırpma yok.';
}

export async function runSelfTest(onLine=()=>{}){
  let pass=0,fail=0,sample;
  const check=async(name,fn)=>{
    try{const message=await fn();pass++;onLine('✓ '+name+'\n'+message);}
    catch(e){fail++;onLine('✕ '+name+'\n'+(e.message||'Test başarısız.'));}
  };
  await check('Görüntü motoru / özgünlük',async()=>{const r=await testPixels();sample=r.sample;return r.message;});
  await check('EXIF yönü',testOrientation);
  await check('Yerel arşiv (geri alınan işlem)',async()=>{await verifyArchiveRollback(sample||new Blob(['test'],{type:'image/png'}));return 'Blob yazma/okuma doğrulandı; sentetik kayıt kalmadı.';});
  await check('PWA çevrimdışı dosyaları',async()=>{
    if(!navigator.serviceWorker?.controller)throw new Error('Service Worker henüz etkin değil; ağ bağlantısıyla bir kez yeniden aç.');
    const name='towcam-pro-'+VERSION;
    if(!(await caches.keys()).includes(name))throw new Error('Sürüm önbelleği henüz hazır değil.');
    const cache=await caches.open(name),keys=await cache.keys();
    const expected=['index.html','app.js','styles.css','camera.js','engine.js','processor.js','worker.js','image-service.js','storage.js','config.js','selftest.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png'];
    const urls=new Set(keys.map(k=>new URL(k.url).pathname));
    if(expected.some(f=>!urls.has('/'+f)))throw new Error('Uygulama önbelleği eksik.');
    return expected.length+' gerekli dosya mevcut; Service Worker etkin.';
  });
  return {pass,fail};
}
