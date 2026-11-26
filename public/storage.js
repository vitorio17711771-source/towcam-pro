const DB_NAME='towcam-pro-local';
let dbPromise;
function open(){
  if(!globalThis.indexedDB)return Promise.reject(new Error('Yerel depolama desteklenmiyor.'));
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      db.createObjectStore('photos',{keyPath:'id'});
      const meta=db.createObjectStore('archive',{keyPath:'id'});meta.createIndex('date','date');
    };
    req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();dbPromise=null;};resolve(db);};
    req.onerror=()=>reject(req.error||new Error('Yerel arşiv açılamadı.'));
    req.onblocked=()=>reject(new Error('Arşiv başka bir pencerede açık.'));
  }).catch(e=>{dbPromise=null;throw e;});
  return dbPromise;
}
function txPromise(tx){
  return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Arşiv işlemi başarısız.'));tx.onabort=()=>reject(tx.error||new Error('Arşiv işlemi iptal edildi.'));});
}
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export async function savePhoto(record){
  const db=await open();const tx=db.transaction(['photos','archive'],'readwrite'),done=txPromise(tx);
  try{
    const {original,enhanced,...metadata}=record;
    tx.objectStore('photos').put({id:record.id,original,enhanced});
    tx.objectStore('archive').put(metadata);
  }catch(e){tx.abort();await done.catch(()=>{});throw e;}
  await done;
}
export async function listPhotos(limit=30,offset=0){
  const db=await open(),tx=db.transaction('archive','readonly');
  return new Promise((resolve,reject)=>{
    const records=[],cursor=tx.objectStore('archive').index('date').openCursor(null,'prev');let skipped=offset===0;
    cursor.onsuccess=()=>{const c=cursor.result;if(!c){resolve(records);return;}if(!skipped){skipped=true;c.advance(offset);return;}records.push(c.value);if(records.length>=limit)resolve(records);else c.continue();};
    cursor.onerror=()=>reject(cursor.error);
  });
}
export async function getPhoto(id){
  const db=await open(),tx=db.transaction(['photos','archive'],'readonly');
  const [photos,metadata]=await Promise.all([request(tx.objectStore('photos').get(id)),request(tx.objectStore('archive').get(id))]);
  if(!photos||!metadata)return null;
  return {...metadata,...photos};
}
export async function deletePhoto(id){
  const db=await open(),tx=db.transaction(['photos','archive'],'readwrite'),done=txPromise(tx);
  tx.objectStore('photos').delete(id);tx.objectStore('archive').delete(id);await done;
}

export async function verifyArchiveRollback(blob){
  const db=await open(),id='diagnostic-'+(globalThis.crypto?.randomUUID?.()||Date.now());
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['photos','archive'],'readwrite'),p=tx.objectStore('photos'),a=tx.objectStore('archive');
    let verified=false,photo,meta,n=0;
    tx.onabort=()=>verified?resolve(true):reject(tx.error||new Error('Yerel arşiv öz testi başarısız.'));
    tx.onerror=()=>reject(tx.error||new Error('Yerel arşiv öz testi başarısız.'));
    tx.oncomplete=()=>reject(new Error('Öz test işlemi geri alınamadı.'));
    const complete=()=>{if(++n===2){verified=photo?.original?.size===blob.size&&photo?.enhanced?.size===blob.size&&meta?.id===id;tx.abort();}};
    // Both writes and reads use the same transaction. Always abort the
    // transaction after checks, so no synthetic photo persists.
    p.put({id,original:blob,enhanced:blob});
    a.put({id,date:Date.now(),thumbnail:blob,profile:'Diagnostic'});
    const pr=p.get(id),mr=a.get(id);
    pr.onsuccess=()=>{photo=pr.result;complete();};
    mr.onsuccess=()=>{meta=mr.result;complete();};
  });
}
