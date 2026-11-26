import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeImage,chooseProfile,processTile} from '../public/engine.js';
const img=(w,h,fn)=>{const d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;d.set([...fn(x,y),255].slice(0,4),i);}return d;};
function run(d,w,h,profile='auto'){
  const a=analyzeImage(d,w,h),p=chooseProfile(a,profile);
  const result=processTile(d,w,h,{x:0,y:0,width:w,height:h,offsetX:0,offsetY:0},p,w,h);return {...result,a,p};
}
function mean(d){let total=0;for(let i=0;i<d.length;i+=4)total+=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];return total/(d.length/4);}
const w=71,h=49;
for(const [label,fn,check] of [
  ['güneşli gündüz',(x,y)=>[130+x%30,140+y%30,150+x%20],r=>r.p.label==='Gündüz'],
  ['bulutlu/düşük kontrast',(x,y)=>[114+x%14,117+y%15,120+x%14],r=>r.a.range<86],
  ['gece sokak',(x,y)=>[22+x%12,24+y%12,25+x%8],r=>r.p.night&&mean(r.data)>r.a.mean],
  ['sarı sokak lambası',(x,y)=>[79+x%4,65+y%4,53+x%4],r=>r.p.night&&r.a.warmth>12],
  ['güçlü farlar',(x,y)=>x<52?[22,22,22]:[255,255,255],r=>r.a.whiteClip>.2],
  ['beyaz araç',(x,y)=>[214+x%10,215+y%10,214+x%10],r=>r.a.highlights>.2],
  ['siyah araç',(x,y)=>[25+x%6,25+y%6,25+x%6],r=>r.p.night],
  ['renkli araç',(x,y)=>[180+x%10,31+y%10,36+x%10],r=>r.data[0]>r.data[1]*2],
  ['karanlık kabin',(x,y)=>[40+x%20,35+y%20,36+x%20],r=>r.p.lowLight],
  ['ters ışık',(x,y)=>x<35?[36,36,36]:[233,233,233],r=>r.a.shadows>.22&&r.a.highlights>.13],
  ['yüksek kontrast',(x,y)=>x<35?[15,15,15]:[225,225,225],r=>r.a.range>170],
  ['düşük kaliteli kumlanma',(x,y)=>{const z=54+(x*17+y*29)%11;return[z,z-3,z+4];},r=>r.a.noise>0],
]){
  test(label,()=>{const d=img(w,h,fn),r=run(d,w,h);assert.equal(r.data.length,d.length);assert.ok(check(r));for(let i=3;i<d.length;i+=4)assert.equal(r.data[i],255);});
}
test('Histogram toplamı ve sabit ton uçları',()=>{
  const d=img(w,h,(x,y)=>[x*3%256,x*3%256,x*3%256]),a=analyzeImage(d,w,h),p=chooseProfile(a);
  assert.equal(a.hist.reduce((x,y)=>x+y),w*h);assert.equal(p.lut[0],0);assert.equal(p.lut[255],255);
  for(let i=1;i<256;i++)assert.ok(p.lut[i]>=p.lut[i-1]);
});
test('Tam siyah ve beyaz kırpılmış alanlar korunur',()=>{
  const d=img(w,h,(x,y)=>x<35?[0,0,0]:[255,255,255]),r=run(d,w,h);
  assert.deepEqual(r.data,d);assert.equal(r.protectedPixels,w*h);
});
test('Yüksek kontrastlı 1 piksellik metin/plaka çizgileri tam korunur',()=>{
  const d=img(80,60,(x,y)=>((x%9===0||y%13===0)&&x>5&&x<75&&y>5&&y<55)?[20,20,20]:[205,205,205]),r=run(d,80,60);
  for(let y=6;y<55;y++)for(let x=6;x<75;x++)if(x%9===0||y%13===0){const i=(y*80+x)*4;assert.deepEqual(r.data.slice(i,i+4),d.slice(i,i+4));}
});
test('Eş parlaklığa yakın renkli kenar korunur',()=>{
  const d=img(12,10,(x,y)=>x<6?[220,10,10]:[12,69,12]),r=run(d,12,10);
  for(let y=0;y<10;y++)for(const x of [5,6]){const i=(y*12+x)*4;assert.deepEqual(r.data.slice(i,i+4),d.slice(i,i+4));}
});
test('Orijinallik profili değişimi azaltır',()=>{
  const d=img(w,h,()=>[43,44,45]),a=run(d,w,h),b=run(d,w,h,'faithful');assert.ok(Math.abs(mean(b.data)-mean(d))<Math.abs(mean(a.data)-mean(d)));
});
test('Parçalı işlem aynı piksel sonucu, dikiş yok',()=>{
  const W=103,H=83,d=img(W,H,(x,y)=>[30+x*2%220,40+y*2%210,(x+y)*2%255]);const all=run(d,W,H);
  const result=new Uint8ClampedArray(d.length),sz=17;
  for(let y=0;y<H;y+=sz)for(let x=0;x<W;x+=sz){
    const width=Math.min(sz,W-x),height=Math.min(sz,H-y),left=Math.max(0,x-1),top=Math.max(0,y-1),right=Math.min(W,x+width+1),bottom=Math.min(H,y+height+1),iw=right-left,ih=bottom-top;
    const tile=new Uint8ClampedArray(iw*ih*4);
    for(let yy=0;yy<ih;yy++)tile.set(d.subarray(((top+yy)*W+left)*4,((top+yy)*W+right)*4),yy*iw*4);
    const r=processTile(tile,iw,ih,{x,y,width,height,offsetX:x-left,offsetY:y-top},all.p,W,H);
    for(let yy=0;yy<height;yy++)result.set(r.data.subarray(yy*width*4,(yy+1)*width*4),((y+yy)*W+x)*4);
  }
  assert.deepEqual(result,all.data);
});
test('Motor giriş verisini değiştirmez ve alfa korunur',()=>{
  const d=img(12,12,(x,y)=>[80,90,100,(x+y)*8]);const copy=d.slice();const r=run(d,12,12);assert.deepEqual(d,copy);for(let i=3;i<d.length;i+=4)assert.equal(r.data[i],copy[i]);
});
test('1x1 fotoğraf ve çok ince geometri güvenli',()=>{
  for(const [W,H] of [[1,1],[1,40],[40,1]]){const d=img(W,H,()=>[95,100,105]);const r=run(d,W,H);assert.equal(r.data.length,d.length);assert.ok(Number.isFinite(r.a.mean));}
});
