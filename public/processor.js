import {analyzeImage,chooseProfile,processTile} from './engine.js';
const isWorker=typeof document==='undefined';
const yieldUI=()=>new Promise(r=>setTimeout(r,0));
function canvas(w,h){
  if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(w,h);
  if(isWorker)throw new Error('OffscreenCanvas kullanılamıyor.');
  const c=document.createElement('canvas');c.width=w;c.height=h;return c;
}
function context(c,read=false){
  const ctx=c.getContext('2d',{alpha:true,willReadFrequently:read,colorSpace:'srgb'});
  if(!ctx)throw new Error('Görüntü tamponu oluşturulamadı.');return ctx;
}
function release(c){if(c){c.width=1;c.height=1;}}
async function decode(blob){
  if(typeof createImageBitmap==='function'){
    try{return await createImageBitmap(blob,{imageOrientation:'from-image'});}catch{}
    try{return await createImageBitmap(blob);}catch{}
  }
  if(isWorker)throw new Error('Görüntü kodu çözülemedi.');
  const url=URL.createObjectURL(blob);
  try{const img=new Image();img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}
}
async function encode(c,type,quality){
  const b=c.convertToBlob?await c.convertToBlob({type,quality}):await new Promise((res,rej)=>c.toBlob(v=>v?res(v):rej(new Error('Dosya kodlanamadı.')),type,quality));
  if(!b||!b.size)throw new Error('Dosya boş.');
  return b;
}
export async function processPhoto(blob,options={},progress=()=>{}){
  const start=performance.now();
  let image,sample,output,tile,thumbCanvas;
  try{
    image=await decode(blob);const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    if(!width||!height)throw new Error('Geçersiz fotoğraf çözünürlüğü.');
    progress(6,'Görüntü analiz ediliyor…');
    const ratio=Math.min(1,384/Math.max(width,height)),sw=Math.max(1,Math.round(width*ratio)),sh=Math.max(1,Math.round(height*ratio));
    sample=canvas(sw,sh);const sc=context(sample,true);sc.drawImage(image,0,0,sw,sh);
    const stats=analyzeImage(sc.getImageData(0,0,sw,sh).data,sw,sh);
    const profile=chooseProfile(stats,options.profile);
    release(sample);sample=null;
    // Only the full-size output bitmap plus decoded source is retained; all
    // working RGB/luma buffers are at most a tile plus one-pixel border.
    output=canvas(width,height);const oc=context(output);
    const size=384;tile=canvas(size+2,size+2);const tc=context(tile,true);
    const total=Math.ceil(width/size)*Math.ceil(height/size);let done=0,protectedPixels=0;
    for(let y=0;y<height;y+=size){
      for(let x=0;x<width;x+=size){
        const w=Math.min(size,width-x),h=Math.min(size,height-y);
        const left=Math.max(0,x-1),top=Math.max(0,y-1);
        const right=Math.min(width,x+w+1),bottom=Math.min(height,y+h+1);
        const iw=right-left,ih=bottom-top;
        tc.clearRect(0,0,iw,ih);
        tc.drawImage(image,left,top,iw,ih,0,0,iw,ih);
        const result=processTile(tc.getImageData(0,0,iw,ih).data,iw,ih,{x,y,width:w,height:h,offsetX:x-left,offsetY:y-top},profile,width,height);
        protectedPixels+=result.protectedPixels;
        oc.putImageData(new ImageData(result.data,w,h),x,y);
        done++;if(done%4===0||done===total){progress(10+Math.floor(done/total*76),'Fotoğraf iyileştiriliyor…');if(!isWorker)await yieldUI();}
      }
    }
    image.close?.();image=null;release(tile);tile=null;
    progress(89,'Dosya hazırlanıyor…');
    const type=options.format==='png'?'image/png':'image/jpeg';
    const enhanced=await encode(output,type,.98);
    // Small local preview, never used as the quality output.
    const tr=Math.min(1,320/Math.max(width,height)),tw=Math.round(width*tr),th=Math.round(height*tr);
    thumbCanvas=canvas(Math.max(1,tw),Math.max(1,th));context(thumbCanvas).drawImage(output,0,0,thumbCanvas.width,thumbCanvas.height);
    const thumbnail=await encode(thumbCanvas,'image/jpeg',.83);
    progress(100,'Hazır');
    return {enhanced,thumbnail,width,height,profile:profile.label,protectedPixels,
      duration:Math.round(performance.now()-start),
      stats:{mean:Math.round(stats.mean),p05:stats.p05,p50:stats.p50,p95:stats.p95,shadows:stats.shadows,highlights:stats.highlights,
        warmth:Math.round(stats.warmth),neutralFraction:stats.neutralFraction,edge:stats.edge,noise:stats.noise,blackClip:stats.blackClip,whiteClip:stats.whiteClip}};
  }finally{image?.close?.();release(sample);release(output);release(tile);release(thumbCanvas);}
}
// Preserve original when the browser cannot allocate/render full resolution.
export async function originalInfo(blob){
  let image,small;
  try{
    image=await decode(blob);const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    let thumbnail=blob;
    try{const scale=Math.min(1,320/Math.max(width,height));small=canvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));context(small).drawImage(image,0,0,small.width,small.height);thumbnail=await encode(small,'image/jpeg',.83);}catch{}
    return {width,height,thumbnail};
  }finally{image?.close?.();release(small);}
}
