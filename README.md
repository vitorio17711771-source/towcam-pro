# TowCam Pro · 1.0.1

**Sen sadece çek, gerisini TowCam halletsin.**

Çekici, araç kurtarma ve yol yardım işleri için Türkçe, reklamsız, üyeliksiz, cihaz üzerinde çalışan kamera PWA'sı. Üretim adresi: https://towcam-pro.pages.dev — mevcut Cloudflare Pages projesi, `main` dalı ve `public` çıktı klasörü korunur. Derleme komutu veya sunucu işlevi gerekmez.

## Kullanım

1. HTTPS adresini Android Chrome veya desteklenen mobil tarayıcıda aç; kamera iznini ver.
2. Deklanşöre dokun. PRO AUTO, fotoğrafı analiz edip otomatik olarak iyileştirir.
3. Sonucu incele; karşılaştırma sürgüsü ile orijinali kontrol et. Kaydet veya dosya paylaşımı destekleniyorsa Paylaş düğmesini kullan.
4. Orijinal dosyayı ayrıca indirebilirsin. Yerel arşiv varsayılan olarak iki dosyayı da saklar; Ayarlar'dan değiştirilebilir. Tarayıcı verileri temizlenirse arşiv silinir.
5. Android Chrome: menü → Uygulamayı yükle / Ana ekrana ekle. Kurulum istemi desteklenirse üst çubukta kurulum düğmesi görünür. iOS Safari: Paylaş → Ana Ekrana Ekle. İlk başarılı PWA önbelleklemesinden sonra uygulama çevrimdışı açılabilir.
6. Ayarlar → Teknik teşhis, önizleme ile gerçek fotoğraf boyutunu, çekim yöntemini, motoru, süreyi ve mevcut cihaz kabiliyetlerini ayrı gösterir.

**Not:** Kaydet düğmesi bir dosya indirme isteği başlatır; işletim sisteminin Galeri uygulamasına sessizce yazıldığını garanti etmez. Paylaş düğmesi Web Share API dosya desteğini sorgular; destek yoksa indirmeye geçer. Tarayıcı depolama sınırları ve temizleme davranışı cihaz tarafından yönetilir; uygulamada yapay çekim kotası yoktur.

Aynı teşhis ekranındaki **Motor öz testi (sentetik)**, kameraya veya kişisel fotoğrafa dokunmadan motoru, EXIF yönünü, geri alınan yerel arşiv işlemini ve PWA önbellek dosyalarını cihazın gerçek tarayıcısında denetler.

## Mimari

| Dosya | Görev |
|---|---|
| `public/index.html`, `styles.css`, `app.js` | Özgün mobil kamera UI, ayarlar, paylaşım, karşılaştırma, arşiv, yaşam döngüsü ve PWA kurulumu |
| `camera.js` | MediaDevices, MediaStreamTrack, donanım özellikleri, ImageCapture, maksimum/otomatik çözünürlük ve video karesi yedeği |
| `engine.js` | Saf deterministik piksel analizi ve işlem |
| `processor.js` | EXIF yönüne göre çözme, 384 px analiz, 384×384 parçalı tam boyutlu çıktı, JPEG/PNG kodlama |
| `worker.js`, `image-service.js` | Worker + OffscreenCanvas, UI parçalı yedek, hata/bellek durumunda orijinali koruma |
| `selftest.js` | Gerçek tarayıcıda sentetik motor, EXIF, arşiv rollback ve cache öz testi |
| `storage.js`, `config.js` | IndexedDB yerel özgün/işlenmiş dosyalar, sayfalı arşiv metaverisi, ayarlar ve sürüm |
| `manifest.webmanifest`, `sw.js`, `icons/` | Kurulabilir PWA, çevrimdışı uygulama dosyaları, sürüm tabanlı önbellek ve maskeleme ikonu |
| `_headers` | CSP, Permissions-Policy ve diğer HTTP güvenlik başlıkları |
| `tests/` | Motor, kamera API taklidi, statik varlıklar, native canvas işlem testleri ve Playwright tarayıcı senaryoları |

### Görüntü motoru

Üretken yapay zekâ, OCR ile karakter yazma, nesne değiştirme, perspektif düzeltme, kırpma, büyütme, inpainting veya süper çözünürlük yoktur. Her fotoğraf kendi histogramı, yüzdelikleri, parlaklık, doygunluk, gölge/aydınlık, nötr renk tahmini, kenar/kumlanma göstergesi ve kaba aydınlık haritasıyla analiz edilir. Monoton ton eğrisi, gölge kaldırma, ışık kontrolü, sınırlı beyaz dengesi, vibrance ve yumuşak yerel kontrast kullanılır. Renkler luma-kroma ayrımıyla, gamut taşması ayrı kanal kırpması yerine kroma ölçeğiyle yönetilir. Kenar duyarlı luminans/kroma kumlanma azaltma ve sınırlandırılmış unsharp uygulanır.

Yüksek kontrastlı parlaklık veya renk kenarları (plaka, metin, logo ve hasar çizgileri dahil) otomatik olarak aynı çözülmüş piksele döner; diğer kenarlarda işlem kademeli zayıflatılır. Çapraz kenarlar da değerlendirilir. Bölge tespiti semantik OCR/plaka tanıma değildir; zayıf kontrastlı yazıda %100 koruma veya okunabilirlik garantisi yoktur. JPEG tekrar kodlama piksel değiştirir; PNG işlenmiş RGB değerlerini kayıpsız saklar. Kamera tarafından döndürülen özgün Blob ayrı ve değişmeden saklanır. Çıktının içeriğini kanıt olarak kullanacaksan orijinal dosyayı muhafaza et. Kırpılmış siyah/beyazda olmayan detay geri getirilemez.

Tam çözünürlükte çıktı; tek kaynak bitmap ve çıktı canvas'ına ek olarak küçük parça tamponları kullanır. İşlem tarayıcı tarafından bildirilen bellek/Canvas limitlerini aşarsa özgün dosyaya geri dönülür; gizlice küçültülmez. Kamera donanımının orijinal Samsung uygulamasında yaptığı çok kareli HDR, ISP, gece birleştirme, özel lens/RAW ve 50 MP modu tarayıcı API'sinde aynı biçimde erişilebilir olmayabilir. Bildirilen kapasite ve gerçek ölçü ayrı gösterilir.

### Gizlilik

Uygulama herhangi bir fotoğraf yükleme API'si, kullanıcı hesabı, reklam, analitik, harici görüntü işleme servisi veya üçüncü taraf çalışma zamanı bağımlılığı içermez. İşlenen veri cihazda tutulur; ağ yalnızca HTTPS statik uygulama dosyalarına/güncellemelerine hizmet eder. IndexedDB verileri aynı cihaz/tarayıcı profili ve siteye özgüdür; ayrı cihazlar, ayrı profiller ve tarayıcı bağlamları birbirlerinin arşivine erişmez. Aynı cihazda aynı tarayıcı profilini kullanan kişiler aynı yerel arşivi görebilir. İşlenmiş dosyaya kaynak EXIF GPS/metadata kopyalanmaz; özgün dosya varsa kendi EXIF bilgilerini aynen içerir. Paylaşılan dosyanın hedef uygulamadaki akışı kullanıcı kontrolündedir.

## Geliştirme ve doğrulama

Uygulama için npm çalışma zamanı veya paket derlemesi gerekmez. Node 22+ ile:
```sh
npm test
npm install --ignore-scripts
npm run test:pipeline
npx playwright install chromium
npm run test:browser
npm run serve
```

Yerel test sunucusu http://localhost:8080 (loopback güvenli bağlam); gerçek telefon testinde mevcut HTTPS üretim adresini kullan. Playwright test paketi sentetik kamera akışı, izin hatası, simüle donanım kontrolleri, sonuç, indirme, mock dosya paylaşımı, offline çalışma, cache güncellemesi, arşiv yalıtımı ve 12/50 MP işlem senaryolarını içerir. Test amaçlı bağımlılıklar: Playwright (Apache-2.0), @napi-rs/canvas (MIT); statik üretim dizinine dahil değildir. Uygulama ikonları özel olarak çizilmiştir; harici görsel veya font kullanmaz.

Sürüm yayınında `config.js`, `sw.js` cache adı ve `package.json` sürümünü birlikte değiştir; ana dal için üretim dağıtımının yeni sürümü getirdiğini doğrula. Service Worker mevcut açık oturumu bütün bir sürümde tutar, yeni sürüm diğer oturumlar kapandığında doğal olarak devreye girer; kullanıcı Ayarlar'dan güvenle güncelleme isteyebilir.

## Teknik başvuru

- [MDN: ImageCapture.takePhoto](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto)
- [MDN: MediaStreamTrack.getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities)
- [MDN: Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [MDN: createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
- [Cloudflare Pages: Custom headers](https://developers.cloudflare.com/pages/configuration/headers/)
