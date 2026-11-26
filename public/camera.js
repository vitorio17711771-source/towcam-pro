const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
const deadline=(promise,ms,message)=>new Promise((resolve,reject)=>{
  let timer=setTimeout(()=>reject(Object.assign(new Error(message),{name:'TimeoutError'})),ms);
  Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});
});
const isRange=x=>x&&Number.isFinite(x.min)&&Number.isFinite(x.max)&&x.max>x.min;
export const hasRange=isRange;
function withControls(track,patch){
  const base=track.getConstraints?.()||{};
  return {...base,advanced:[Object.assign({},...(base.advanced||[]),patch)]};
}
function withResolution(track,width,height,frameRate=24){return {...(track.getConstraints?.()||{}),width:{ideal:width},height:{ideal:height},frameRate:{ideal:frameRate}};}
const readableError=e=>{
  switch(e?.name){
    case 'NotAllowedError':case 'PermissionDeniedError':return ['Kamera izni gerekli','Tarayıcının site ayarlarından kamera iznini ver ve tekrar dene.'];
    case 'NotFoundError':case 'DevicesNotFoundError':return ['Kamera bulunamadı','Kameralı bir telefonda veya kamera bağlıyken tekrar dene.'];
    case 'NotReadableError':case 'TrackStartError':return ['Kamera kullanılamıyor','Kamerayı kullanan diğer uygulamaları kapat ve tekrar dene.'];
    case 'SecurityError':return ['Kamera erişimi kısıtlı','Uygulamayı güvenli HTTPS bağlantısıyla ve doğrudan tarayıcıda aç.'];
    case 'AbortError':return ['Kamera kesildi','Kamerayı tekrar başlat.'];
    default:return ['Kamera açılamadı',e?.message||'Tarayıcı ve cihaz izinlerini kontrol et.'];
  }
};
export {readableError};

export class Camera {
  constructor(video,onEnded=()=>{}){
    this.video=video;this.onEnded=onEnded;this.stream=null;this.track=null;this.seq=0;this.facing='environment';
    this.cap={};this.photoCap={};this.photoSettings={};this.capture=null;this.devices=[];this.settings={};this.torchOn=false;this.busy=false;
    this.lightCanvas=null;this.captureTime=0;this.startTime=0;
  }
  get active(){return this.track?.readyState==='live'&&this.video.videoWidth>0;}
  async start(facing=this.facing,{exact=false}={}){
    this.stop();const token=this.seq,start=performance.now();this.facing=facing;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Object.assign(new Error('HTTPS ve desteklenen tarayıcı gerekiyor.'),{name:'SecurityError'});
    const video={facingMode:exact?{exact:facing}:{ideal:facing},width:{ideal:1920},height:{ideal:1440},frameRate:{ideal:30,max:30}};
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video});}
    catch(e){
      if(exact||!['OverconstrainedError','TypeError'].includes(e.name))throw e;
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing}}});
    }
    if(token!==this.seq){stream.getTracks().forEach(t=>t.stop());throw Object.assign(new Error('İptal edildi.'),{name:'AbortError'});}
    this.stream=stream;this.track=stream.getVideoTracks()[0];
    if(!this.track){this.stop();throw new Error('Kamera video akışı bulunamadı.');}
    try{
      const track=this.track;
      this.cap=track.getCapabilities?.()||{};this.settings=track.getSettings?.()||{};
      this.facing=this.settings.facingMode||facing;
      track.addEventListener('ended',()=>{if(this.track===track){this.stop();this.onEnded();}},{once:true});
      this.video.srcObject=stream;
      await deadline(this.video.play(),10000,'Kamera önizlemesi zaman aşımına uğradı.');
      // Real frames should be available before shutter is enabled.
      for(let i=0;!this.video.videoWidth&&i<30;i++){await delay(50);if(token!==this.seq)throw new Error('Kamera başlatma iptal edildi.');}
      if(!this.video.videoWidth)throw new Error('Kamera görüntüsü hazır değil.');
      if(typeof ImageCapture==='function'){
        try{this.capture=new ImageCapture(track);}catch{}
        if(this.capture){
          const [pc,ps]=await Promise.allSettled([
            Promise.resolve().then(()=>deadline(this.capture.getPhotoCapabilities(),2200,'Yetenek sorgusu zaman aşımı.')),
            Promise.resolve().then(()=>deadline(this.capture.getPhotoSettings(),1500,'Çekim ayarı sorgusu zaman aşımı.'))]);
          if(token===this.seq){this.photoCap=pc.status==='fulfilled'?pc.value||{}:{};this.photoSettings=ps.status==='fulfilled'?ps.value||{}:{};}
        }
      }
      if(token!==this.seq)throw Object.assign(new Error('İptal edildi.'),{name:'AbortError'});
      // Without the still API, obtain the best available video frame
      // instead of arbitrarily scaling a small preview.
      if(!this.capture){
        const c=this.cap;
        if(c.width?.max&&c.height?.max){
          try{await deadline(track.applyConstraints(withResolution(track,c.width.max,c.height.max)),3500,'Video çözünürlüğü ayarı zaman aşımı.');}catch{}
        }
      }
      const advanced={};
      for(const feature of ['focusMode','exposureMode','whiteBalanceMode'])if(this.cap[feature]?.includes?.('continuous'))advanced[feature]='continuous';
      if(Object.keys(advanced).length){try{await deadline(track.applyConstraints(withControls(track,advanced)),2000,'Kamera kontrolü zaman aşımı.');}catch{}}
      if(token!==this.seq)throw Object.assign(new Error('İptal edildi.'),{name:'AbortError'});
      this.settings=track.getSettings?.()||{};
      try{this.devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');}catch{}
      if(token!==this.seq)throw Object.assign(new Error('İptal edildi.'),{name:'AbortError'});
      this.startTime=Math.round(performance.now()-start);return this;
    }catch(e){if(token===this.seq)this.stop();throw e;}
  }
  stop(){
    this.seq++;
    if(this.stream)this.stream.getTracks().forEach(t=>t.stop());
    this.video.pause();this.video.srcObject=null;this.video.style.filter='';
    this.stream=null;this.track=null;this.capture=null;this.cap={};this.photoCap={};this.photoSettings={};this.settings={};this.torchOn=false;
  }
  async switch(){
    const old=this.facing,next=old==='environment'?'user':'environment';
    const pending=this.start(next,{exact:true});const token=this.seq;
    try{return await pending;}catch(e){
      if(e.name==='AbortError'||token!==this.seq)throw e;
      try{await this.start(old,{exact:false});}catch{}
      throw new Error('Diğer kamera açılamadı; mevcut kamerayı kullanabilirsin.');
    }
  }
  async setControl(name,value){
    const track=this.track;
    if(!track||track.readyState!=='live')throw new Error('Kamera hazır değil.');
    await deadline(track.applyConstraints(withControls(track,{[name]:value})),2500,'Kamera kontrolü zaman aşımı.');
    if(track!==this.track)throw new Error('Kamera değişti.');
    this.settings=track.getSettings?.()||{};
    return this.settings[name];
  }
  async setFocus(x,y){
    const track=this.track;if(!track||track.readyState!=='live')throw new Error('Kamera hazır değil.');
    await deadline(track.applyConstraints(withControls(track,{pointsOfInterest:[{x,y}],focusMode:'single-shot'})),2500,'Odaklama zaman aşımı.');
    if(track!==this.track)throw new Error('Kamera değişti.');
  }
  async toggleTorch(){
    if(!this.cap.torch)throw new Error('Flaş desteklenmiyor.');
    const next=!this.torchOn,actual=await this.setControl('torch',next);
    if(typeof actual!=='boolean'||actual!==next)throw new Error('Flaş durumu cihaz tarafından doğrulanmadı.');
    this.torchOn=actual;return this.torchOn;
  }
  get light(){
    if(!this.active)return null;
    try{
      if(!this.lightCanvas){this.lightCanvas=document.createElement('canvas');this.lightCanvas.width=64;this.lightCanvas.height=48;}
      const c=this.lightCanvas.getContext('2d',{willReadFrequently:true});c.drawImage(this.video,0,0,64,48);
      const d=c.getImageData(0,0,64,48).data;let sum=0;
      for(let i=0;i<d.length;i+=4)sum+=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
      return sum/(d.length/4);
    }catch{return null;}
  }
  async take(settings){
    if(!this.active||this.busy)throw new Error('Kamera henüz hazır değil.');
    this.busy=true;const token=this.seq,t0=performance.now(),track=this.track;
    try{
      let blob=null,method='ImageCapture.takePhoto()',reason='';
      const light=this.light;
      if(this.capture){
        const cap=this.photoCap||{},photo={};
        const max=settings.quality==='max'||(settings.quality==='auto'&&light!==null&&light>=92);
        if(max){if(cap.imageWidth?.max>0)photo.imageWidth=cap.imageWidth.max;if(cap.imageHeight?.max>0)photo.imageHeight=cap.imageHeight.max;}
        if(cap.fillLightMode?.includes(settings.flash))photo.fillLightMode=settings.flash;
        try{
          blob=await deadline(this.capture.takePhoto(photo),20000,'Fotoğraf çekimi zaman aşımına uğradı.');
        }catch(e){
          if(e.name==='TimeoutError'||token!==this.seq)throw e;
          try{blob=await deadline(this.capture.takePhoto(),18000,'Fotoğraf çekimi zaman aşımına uğradı.');reason='İstenen çekim ayarları uygulanamadı; varsayılan çekim kullanıldı.';}
          catch(e2){if(e2.name==='TimeoutError'||token!==this.seq)throw e2;reason='Fotoğraf API’si çekimi tamamlayamadı.';}
        }
      }else reason='Fotoğraf API’si desteklenmiyor.';
      if(token!==this.seq||track!==this.track)throw Object.assign(new Error('Çekim kesildi.'),{name:'AbortError'});
      if(!blob){
        method='Video karesi (yedek yöntem)';
        // If still capture failed, request the largest reported frame,
        // then observe the actual video dimensions; no upscaling.
        if(this.capture&&this.cap.width?.max&&this.cap.height?.max){
          try{await deadline(track.applyConstraints(withResolution(track,this.cap.width.max,this.cap.height.max)),3500,'Yedek çözünürlük ayarlanamadı.');await delay(100);}catch{}
        }
        if(token!==this.seq||!this.active)throw new Error('Kamera akışı sona erdi.');
        const width=this.video.videoWidth,height=this.video.videoHeight;
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        try{
          const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Fotoğraf tamponu oluşturulamadı.');
          ctx.drawImage(this.video,0,0);blob=await new Promise((res,rej)=>canvas.toBlob(v=>v?res(v):rej(new Error('Video karesi kaydedilemedi.')),'image/jpeg',.99));
        }finally{canvas.width=canvas.height=1;}
      }
      if(!blob?.size)throw new Error('Kamera boş dosya döndürdü.');
      if(token!==this.seq)throw new Error('Çekim kesildi.');
      this.captureTime=Math.round(performance.now()-t0);
      return {blob,method,reason,captureTime:this.captureTime,light};
    }finally{this.busy=false;}
  }
  info(){
    const c=this.cap,s=this.settings,p=this.photoCap;
    const range=n=>isRange(n)?n.min+' – '+n.max+' (adım: '+(n.step??'?')+')':'Bildirilmedi';
    return {
      camera:this.track?.label||'Hazır değil',facing:s.facingMode||'Bildirilmedi',
      preview:this.video.videoWidth?this.video.videoWidth+' × '+this.video.videoHeight:'—',
      videoMax:c.width?.max&&c.height?.max?c.width.max+' × '+c.height.max:'Bildirilmedi',
      photoMax:p.imageWidth?.max&&p.imageHeight?.max?p.imageWidth.max+' × '+p.imageHeight.max:'Bildirilmedi',
      defaultPhoto:this.photoSettings.imageWidth&&this.photoSettings.imageHeight?this.photoSettings.imageWidth+' × '+this.photoSettings.imageHeight:'Bildirilmedi',
      imageCaptureAPI:typeof ImageCapture==='function',photoCapture:!!this.capture,torch:!!c.torch,flash:p.fillLightMode?.join(', ')||'Bildirilmedi',
      zoom:range(c.zoom),focus:c.focusMode?.join(', ')||'Bildirilmedi',exposure:c.exposureMode?.join(', ')||'Bildirilmedi',
      exposureCompensation:range(c.exposureCompensation),whiteBalance:c.whiteBalanceMode?.join(', ')||'Bildirilmedi',devices:this.devices.length,
      frameRate:s.frameRate??'Bildirilmedi',startTime:this.startTime
    };
  }
}
