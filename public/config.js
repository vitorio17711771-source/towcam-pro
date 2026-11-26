export const VERSION = '1.0.1';
export const DEFAULT_SETTINGS = Object.freeze({quality:'auto', profile:'auto', format:'jpeg', grid:false, preview:true, autoArchive:true, autoDownload:false, flash:'auto'});
export function readSettings(){
  try{
    const raw=JSON.parse(localStorage.getItem('towcam-settings')||'{}');
    const result={...DEFAULT_SETTINGS};
    for(const k of ['grid','preview','autoArchive','autoDownload']) if(typeof raw[k]==='boolean')result[k]=raw[k];
    for(const [k,choices] of Object.entries({quality:['auto','max','native'],profile:['auto','faithful'],format:['jpeg','png'],flash:['auto','off','flash']})) if(choices.includes(raw[k])) result[k]=raw[k];
    return result;
  }catch{return {...DEFAULT_SETTINGS};}
}
export function writeSettings(settings){try{localStorage.setItem('towcam-settings',JSON.stringify(settings));}catch{}}
