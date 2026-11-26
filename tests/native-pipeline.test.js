// Tests the production pixel pipeline/encoding in Node with a native canvas
// adapter. This is NOT a browser, camera, or Android hardware measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createCanvas,ImageData,loadImage}=require('@napi-rs/canvas');
globalThis.ImageData=ImageData;
globalThis.OffscreenCanvas=class{
  constructor(w,h){
    const c=createCanvas(w,h);
    c.convertToBlob=async({type='image/png',quality=.98}={})=>{
      const buf=await c.encode(type==='image/jpeg'?'jpeg':'png',Math.round(quality*100));
      return new Blob([buf],{type});
    };
    return c;
  }
};
globalThis.createImageBitmap=async blob=>loadImage(Buffer.from(await blob.arrayBuffer()));
const {processPhoto}=await import('../public/processor.js');
const {enhance}=await import('../public/image-service.js');
const blobFor=async(c,fmt='png')=>new Blob([await c.encode(fmt,98)],{type:'image/'+(fmt==='jpeg'?'jpeg':'png')});
function make(w,h){
  const c=createCanvas(w,h),g=c.getContext('2d');
  const grad=g.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#22252a');grad.addColorStop(.6,'#777980');grad.addColorStop(1,'#c7c2bc');
  g.fillStyle=grad;g.fillRect(0,0,w,h);
  g.fillStyle='#1d242b';g.fillRect(w*.08,h*.18,w*.84,h*.5);
  g.fillStyle='#e8e8e1';g.fillRect(w*.26,h*.45,w*.48,h*.13);
  g.font='bold '+Math.round(w*.042)+'px sans-serif';g.fillStyle='#181818';g.fillText('34 TOW 2026',w*.3,h*.54);
  g.fillStyle='#ffebb9';g.fillText('ÇEKİCİ ŞĞÜÖİ',w*.13,h*.3);
  g.font=Math.round(w*.03)+'px sans-serif';g.fillText('0555 123 45 67',w*.13,h*.38);
  g.strokeStyle='#f4be65';g.lineWidth=w*.006;g.strokeRect(w*.78,h*.24,w*.075,h*.15);
  return c;
}
test('PNG: metin, Türkçe karakterler, telefon, plaka, logo; güçlü kenarlar RGB birebir',async()=>{
  const w=960,h=540,c=make(w,h),ctx=c.getContext('2d'),source=ctx.getImageData(0,0,w,h).data,input=await blobFor(c);
  const originalSHA=createHash('sha256').update(Buffer.from(await input.arrayBuffer())).digest('hex');
  const result=await processPhoto(input,{format:'png'});const image=await loadImage(Buffer.from(await result.enhanced.arrayBuffer()));
  assert.equal(image.width,w);assert.equal(image.height,h);assert.equal(result.enhanced.type,'image/png');
  ctx.clearRect(0,0,w,h);ctx.drawImage(image,0,0);const output=ctx.getImageData(0,0,w,h).data;
  let edges=0,exact=0;const L=i=>.2126*source[i]+.7152*source[i+1]+.0722*source[i+2];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=(y*w+x)*4,l=L(i),delta=Math.max(Math.abs(l-L(i-4)),Math.abs(l-L(i+4)),Math.abs(l-L(i-w*4)),Math.abs(l-L(i+w*4)));
    if(delta>=46){edges++;if(source[i]===output[i]&&source[i+1]===output[i+1]&&source[i+2]===output[i+2])exact++;}
  }
  assert.ok(edges>1000);assert.equal(exact,edges);assert.equal(createHash('sha256').update(Buffer.from(await input.arrayBuffer())).digest('hex'),originalSHA);
  console.log('PIXEL_TEST',JSON.stringify({edges,exact,protected:result.protectedPixels,width:w,height:h,duration:result.duration}));
});
test('JPEG 12 MP: tam çözünürlük ve özgün dosya değişmezliği',async()=>{
  const w=4000,h=3000,c=make(w,h),input=await blobFor(c,'jpeg');c.width=c.height=1;
  const sha=createHash('sha256').update(Buffer.from(await input.arrayBuffer())).digest('hex');
  const result=await processPhoto(input,{format:'jpeg'});const image=await loadImage(Buffer.from(await result.enhanced.arrayBuffer()));
  assert.equal(result.width,w);assert.equal(result.height,h);assert.equal(image.width,w);assert.equal(image.height,h);assert.equal(result.enhanced.type,'image/jpeg');assert.equal(createHash('sha256').update(Buffer.from(await input.arrayBuffer())).digest('hex'),sha);
  console.log('PERF_12MP',JSON.stringify({width:w,height:h,duration:result.duration,bytes:result.enhanced.size,profile:result.profile}));
});
test('JPEG ~50 MP: tam çözünürlük, parçalı işleme',async()=>{
  const w=8160,h=6120,c=make(w,h),input=await blobFor(c,'jpeg');c.width=c.height=1;
  const result=await processPhoto(input,{format:'jpeg'});const image=await loadImage(Buffer.from(await result.enhanced.arrayBuffer()));
  assert.equal(result.width,w);assert.equal(result.height,h);assert.equal(image.width,w);assert.equal(image.height,h);
  console.log('PERF_50MP',JSON.stringify({width:w,height:h,duration:result.duration,bytes:result.enhanced.size,profile:result.profile}));
});
test('Worker bulunmadığında parçalı işlem; PNG tipi ve boyut',async()=>{
  const input=await blobFor(make(180,95)),result=await enhance(input,{format:'png'},()=>{});
  assert.equal(result.width,180);assert.equal(result.height,95);assert.equal(result.enhanced.type,'image/png');assert.match(result.engine,/Parçalı Canvas/);
});
test('İşleme tamponu tahsis edilemezse özgün dosyaya geri dönüş',async()=>{
  const c=make(90,60),blob=await blobFor(c),o=globalThis.OffscreenCanvas;
  // Simulate output allocation failure only when full image is requested.
  let calls=0;globalThis.OffscreenCanvas=class{constructor(w,h){calls++;if(calls===2)throw new Error('test allocation');return new o(w,h);}};
  try{const result=await enhance(blob,{format:'jpeg'},()=>{});assert.equal(result.enhanced,blob);assert.match(result.warning,/orijinal/);assert.equal(result.width,90);assert.equal(result.height,60);}finally{globalThis.OffscreenCanvas=o;}
});
