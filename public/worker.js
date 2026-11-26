import {processPhoto} from './processor.js';
self.onmessage=async({data})=>{
  try{
    const result=await processPhoto(data.blob,data.options,(value,label)=>self.postMessage({type:'progress',value,label}));
    self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',message:error?.message||'İşleme hatası'});}
};
