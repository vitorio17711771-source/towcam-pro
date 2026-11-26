import test from 'node:test';
import assert from 'node:assert/strict';
import {Camera,readableError} from '../public/camera.js';
const makeError=(name)=>Object.assign(new Error(name),{name});
class MockTrack extends EventTarget{
  constructor(facing='environment'){super();this.readyState='live';this.label='Test camera';this.settings={facingMode:facing,width:1920,height:1440,zoom:1,torch:false,exposureCompensation:0};}
  stop(){this.readyState='ended';}
  getSettings(){return {...this.settings};}
  getCapabilities(){return {width:{min:320,max:4000},height:{min:240,max:3000},zoom:{min:1,max:4,step:.1},torch:true,focusMode:['continuous','single-shot'],exposureMode:['continuous'],whiteBalanceMode:['continuous']};}
  async applyConstraints(v){if(v.advanced)Object.assign(this.settings,v.advanced[0]);}
}
let photos=[],tracks=[],apiMode='ok',userMediaError=null,endedCount=0;
function setup(){
  photos=[];tracks=[];apiMode='ok';userMediaError=null;endedCount=0;
  const v={srcObject:null,videoWidth:1920,videoHeight:1440,style:{},play:async()=>{},pause(){}};
  const mediaDevices={
    getUserMedia:async({video})=>{if(userMediaError)throw userMediaError;const t=new MockTrack(video.facingMode?.exact||video.facingMode?.ideal);tracks.push(t);return {getTracks:()=>[t],getVideoTracks:()=>[t]};},
    enumerateDevices:async()=>[{kind:'videoinput'},{kind:'videoinput'}]
  };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices}});
  globalThis.window={isSecureContext:true};
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(64*48*4).fill(135)})}),toBlob:f=>f(new Blob(['frame'],{type:'image/jpeg'}))})};
  globalThis.ImageCapture=class{
    constructor(track){this.track=track;}
    async getPhotoCapabilities(){return {imageWidth:{max:4000},imageHeight:{max:3000},fillLightMode:['auto','off','flash']};}
    async getPhotoSettings(){return {imageWidth:2000,imageHeight:1500};}
    async takePhoto(settings){photos.push(settings);if(apiMode==='fail'||(apiMode==='default-only'&&settings!==undefined))throw new Error('Photo API failed');return new Blob(['original'],{type:'image/jpeg'});}
  };
  return new Camera(v,()=>{endedCount++;});
}
test('Kamera izni ve yetenekler; gerçek çekim API birincil',async()=>{
  const c=setup();await c.start();assert.ok(c.active);assert.equal(c.info().photoMax,'4000 × 3000');assert.equal(c.info().preview,'1920 × 1440');
  const s=await c.take({quality:'max',flash:'flash'});assert.equal(s.method,'ImageCapture.takePhoto()');assert.equal(await s.blob.text(),'original');assert.deepEqual(photos[0],{imageWidth:4000,imageHeight:3000,fillLightMode:'flash'});
  c.stop();assert.equal(c.active,false);assert.equal(tracks[0].readyState,'ended');assert.equal(c.video.srcObject,null);
});
test('Düşük ışık otomatik: zorlanmış maksimum çekim yok',async()=>{
  const c=setup();Object.defineProperty(c,'light',{value:30});await c.start();await c.take({quality:'auto',flash:'auto'});assert.deepEqual(photos[0],{fillLightMode:'auto'});c.stop();
});
test('Desteklenmeyen fotoğraf ayarı gerçek varsayılan çekime döner',async()=>{
  const c=setup();apiMode='default-only';await c.start();const s=await c.take({quality:'max',flash:'auto'});assert.equal(photos.length,2);assert.equal(photos[1],undefined);assert.match(s.reason,/varsayılan/);c.stop();
});
test('Capture API hatası video yedeğine döner, yöntem açık',async()=>{
  const c=setup();apiMode='fail';await c.start();const s=await c.take({quality:'native',flash:'auto'});assert.match(s.method,/Video karesi/);assert.equal(await s.blob.text(),'frame');c.stop();
});
test('API bulunmadığında video yedeği',async()=>{
  const c=setup();delete globalThis.ImageCapture;await c.start();const s=await c.take({quality:'auto',flash:'auto'});assert.match(s.method,/yedek/);assert.equal(photos.length,0);c.stop();
});
test('İzin reddi hata yönetimi',async()=>{
  const c=setup();userMediaError=makeError('NotAllowedError');await assert.rejects(c.start(),{name:'NotAllowedError'});assert.equal(c.active,false);assert.match(readableError(userMediaError)[0],/izni/);userMediaError=null;await c.start();assert.ok(c.active);c.stop();
});
test('Arka ön kamera geçişi ve önceki track serbest',async()=>{
  const c=setup();await c.start();await c.switch();assert.equal(c.facing,'user');assert.equal(tracks[0].readyState,'ended');await c.switch();assert.equal(c.facing,'environment');c.stop();
});
test('Torch ve zoom ayarı bildirilen gerçek değere göre',async()=>{
  const c=setup();await c.start();assert.equal(await c.toggleTorch(),true);assert.equal(await c.toggleTorch(),false);assert.equal(await c.setControl('zoom',2.5),2.5);c.stop();
});
test('Track kesilmesi callback ve kaynakları serbest bırakır',async()=>{
  const c=setup();await c.start();c.track.dispatchEvent(new Event('ended'));assert.equal(endedCount,1);assert.equal(c.active,false);assert.equal(c.video.srcObject,null);await c.start();assert.ok(c.active);c.stop();
});
test('Çakışan çekim isteği engellenir',async()=>{
  const c=setup();await c.start();const first=c.take({quality:'native',flash:'auto'});await assert.rejects(c.take({quality:'native',flash:'auto'}),/henüz hazır değil/);await first;c.stop();
});
test('İzin beklenirken sayfa terk edildiğinde gelen track durdurulur',async()=>{
  const c=setup();let resolve;
  navigator.mediaDevices.getUserMedia=()=>new Promise(r=>{resolve=r;});
  const pending=c.start();c.stop();const track=new MockTrack();resolve({getTracks:()=>[track],getVideoTracks:()=>[track]});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(track.readyState,'ended');assert.equal(c.video.srcObject,null);
});
