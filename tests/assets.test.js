import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const path=p=>resolve('public',p),read=p=>readFileSync(path(p),'utf8');
test('HTML kimlikleri tekil ve JS kullandığı bütün kimlikler var',()=>{
  const html=read('index.html'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
  const script=read('app.js');for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(m[1]),m[1]);
  assert.doesNotMatch(html,/<script(?![^>]+src=)[^>]*>/);
  assert.doesNotMatch(html,/\son\w+=/);
});
test('Manifest kapsamı, ikonların gerçek boyutu, maskable',()=>{
  const m=JSON.parse(read('manifest.webmanifest'));assert.equal(m.start_url,'/');assert.equal(m.scope,'/');assert.equal(m.display,'standalone');
  assert.equal(m.icons.length,3);for(const icon of m.icons){const b=readFileSync(path(icon.src.slice(1)));const [w,h]=icon.sizes.split('x').map(Number);assert.equal(b.readUInt32BE(16),w);assert.equal(b.readUInt32BE(20),h);}
  assert.ok(m.icons.some(i=>i.purpose==='maskable'));
});
test('Service Worker bütün uygulama dosyalarını önbellekler; sürüm tutarlılığı',()=>{
  const sw=read('sw.js'),config=read('config.js');const cache=sw.match(/const CACHE='towcam-pro-([^']+)'/)[1];
  assert.ok(config.includes("'"+cache+"'"));const assets=sw.match(/const ASSETS=(\[[^\n]+\]);/)[1].replaceAll("'",'"');const list=JSON.parse(assets);
  for(const a of list)assert.ok(existsSync(path(a)),a);
  for(const p of ['app.js','camera.js','config.js','engine.js','processor.js','worker.js','image-service.js','storage.js','selftest.js','styles.css','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png'])assert.ok(list.includes('./'+p),p);
  assert.match(sw,/req.method!=='GET'/);assert.match(sw,/url.origin!==self.location.origin/);
});
test('Statik uygulamada dış ağ istemcisi, analitik veya yükleme endpointi yok',()=>{
  for(const f of ['app.js','camera.js','config.js','engine.js','processor.js','worker.js','image-service.js','storage.js','selftest.js']){
    const s=read(f);assert.doesNotMatch(s,/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/);
    assert.doesNotMatch(s,/https?:\/\//);
  }
  const headers=read('_headers');assert.match(headers,/connect-src 'self'/);assert.match(headers,/camera=\(self\), microphone=\(\), geolocation=\(\)/);
  assert.match(headers,/frame-ancestors 'none'/);assert.match(headers,/object-src 'none'/);
});
