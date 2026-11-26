import {processPhoto,originalInfo} from './processor.js';

export async function enhance(blob,options,progress){
  let worker;
  if(typeof Worker==='function'&&typeof OffscreenCanvas==='function'){
    try{
      worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module',name:'towcam-processor'});
      const result=await new Promise((resolve,reject)=>{
        let timeout;
        const reset=()=>{clearTimeout(timeout);timeout=setTimeout(()=>reject(new Error('Görüntü işleme zaman aşımı.')),90000);};reset();
        const finish=(fn,v)=>{clearTimeout(timeout);fn(v);};
        worker.onmessage=({data})=>{
          if(data.type==='progress'){reset();progress(data.value,data.label);}
          else if(data.type==='result')finish(resolve,data.result);
          else if(data.type==='error')finish(reject,new Error(data.message));
        };
        worker.onerror=()=>finish(reject,new Error('Arka plan işleyici başlatılamadı.'));
        worker.onmessageerror=()=>finish(reject,new Error('Arka plan sonucu okunamadı.'));
        worker.postMessage({blob,options});
      });
      return {...result,engine:'Web Worker + OffscreenCanvas · RGB'};
    }catch(error){
      // If a worker cannot allocate the image, don't immediately repeat a
      // potentially memory-intensive operation on the UI thread.
      if(!/başlatılamadı|OffscreenCanvas|kodu çözülemedi/i.test(error.message)){
        const info=await originalInfo(blob);return {...info,enhanced:blob,profile:'Orijinal',protectedPixels:0,duration:0,engine:'Orijinal koruma',warning:'Tam çözünürlükte işleme tamamlanamadı; orijinal dosya korundu.'};
      }
    }finally{worker?.terminate();}
  }
  try{
    const result=await processPhoto(blob,options,progress);
    return {...result,engine:'Parçalı Canvas · RGB'};
  }catch{
    const info=await originalInfo(blob);return {...info,enhanced:blob,profile:'Orijinal',protectedPixels:0,duration:0,engine:'Orijinal koruma',warning:'Tam çözünürlükte işleme tamamlanamadı; orijinal dosya korundu.'};
  }
}
