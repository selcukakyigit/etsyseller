# SaaS Hazırlık Raporu

Tarih: 2026-09-21. Proje: Etsy yönetim / SEO / finans aracı (FastAPI backend + Next.js frontend, yerel-önce mimari).
Amaç: Aracı başkalarına da satan bir SaaS ürününe çevirmek için gerekenleri ve sırayı kaydetmek.

> Bu rapor Etsy'nin resmi rehberleri (`introduction`, `essentials/rate-limits`, `essentials/webhooks`, `essentials/authentication`)
> okunarak hazırlandı. "Doğrulanmadı" yazan yerler tahmindir ya da kontrol edilmemiştir.

---

## 1. En büyük engel: Etsy API uygulama türü

| Tür | Kim için | Ticari kullanım | Onay |
|---|---|---|---|
| Seller App | Kendi mağazası için satıcı | Yasak, yalnızca kendi mağazası | Otomatik, dakikalar |
| Personal App | Başkalarına sınırlı ölçekte | Sınırlı | Derin inceleme |
| Commercial Access | Başkalarına geniş ölçekte | Serbest (onaydan sonra) | Elle inceleme, süre belirsiz |

- Mevcut uygulamanın türü kontrol edilmeli (Developer Portal → Your Apps). Büyük olasılıkla Seller App: başka satıcı bağlanamaz.
- Yol: Personal App onayı → "Request Commercial Access" → elle inceleme.
- **Bu başvuru ürünü en çok geciktirebilecek kalem, erken başlatılmalı.**

### Commercial Access inceleme şartları
1. Etsy API Terms of Use'a uyum.
2. **Önbellek (caching) politikasına uyum** (API Terms Bölüm 1). Bu metin okunmadı; yerel-önce mimarinin veriyi uzun süre saklaması bu şartla çelişebilir, mutlaka kontrol et.
3. Etsy'den ayrı görünme + şu cümle görünür yerde: "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc."
4. Ekran kazıma yok (bizde yok).
5. Özel veri için OAuth (bizde var).
6. **Uygulama adı ve logo Etsy marka politikasına uymalı.** Şu an arayüzde "Etsy Otomasyon" yazıyor, ürün adında "Etsy" geçmemeli.
7. `transactions_r` kullanan ticari uygulamalar `buyer_email` alanını ayrıca talep etmeli.

## 2. Kota (rate limit)
- Limitler **API anahtarı düzeyinde**: tüm müşteriler aynı QPS ve günlük (QPD) kotayı paylaşır. Kayan 24 saatlik pencere.
- Aşılırsa 429 + `retry-after`. Artırma: developer@etsy.com'a uygulama açıklaması + tahmini kullanım.
- Mevcut kota Developer Portal'da görünür (bu raporda bilinmiyor).
- Bizim ilk kurulum maliyetimiz (kaba tahmin, ölçülmedi): mağaza başına ~1000–1500 istek
  (siparişler ~55, ledger ~430, ödemeler ~110, listing envanter/özellik/ekstralar ~400+).
  100 yeni müşteri ≈ 100 bin istek. Büyümenin fiili sınırı bu olabilir.
- **Webhook** var (commercial ve personal uygulamalarda): `order.paid`, `order.canceled`, `order.shipped`, `order.delivered`.
  Polling yerine kullanılırsa kota çok düşer. Gerekenler: herkese açık HTTPS callback, imza doğrulama (HMAC-SHA256), 5 dk zaman aşımı kontrolü.
- Token ömrü: access 1 saat, refresh 90 gün (90 gün kullanılmazsa satıcının yeniden yetki vermesi gerekir).

## 3. Teknik hazırlık

Hazır olanlar:
- Mağaza/kullanıcı bazında ayrım (`shop_id`, sahiplik denetimi), OAuth PKCE, artımlı senkronizasyon.
- Finans hesapları gerçek veriyle doğrulandı (5450 sipariş, 42 bin ledger satırı; Etsy ekranıyla ~%0,8 kur farkı).

Eksikler:
| Alan | Durum |
|---|---|
| Veritabanı | SQLite → PostgreSQL gerekir |
| Arka plan işleri | İş parçacıkları; sunucu yeniden başlarsa kaybolur → kuyruk (Celery/RQ vb.) |
| Etsy kotası | Günlük sayaç, 429 için üstel geri çekilme, mağaza başına adalet yok |
| Token güvenliği | OAuth token'ları şifresiz; oturum token'ları hash'lenmiyor |
| Kişisel veri | Alıcı adı/adresi saklanıyor → KVKK/GDPR, saklama süresi, bağlantı kesilince silme |
| Güvenlik | Kayıt kapatma, giriş denemesi sınırı, şifre kuralları, 2FA, yükleme sınırları, nosniff, prod ayarları |
| Test/izleme | Otomatik test yok; hata izleme, log toplama, yedekleme yok |
| Ticari | Abonelik/ödeme (ör. Stripe), plan sınırları, destek, kullanım şartları, gizlilik politikası |
| OpenAI | Müşteri mağaza verisi üçüncü tarafa gidiyor → gizlilik metninde belirtilmeli, maliyet planı |
| Ölçek | Finans raporu her istekte tüm siparişleri baştan hesaplıyor (~1 sn/5450 sipariş) → büyük mağazada yavaşlar |

## 4. Yazma işlemlerinin riski
Başkalarının canlı mağazasında toplu düzenleme, yayınlama, silme yapılıyor. Hata müşterinin ürününü bozar.
Gerekenler: denetim kaydı, geri alma, "önce önizle", kademeli açma. Ayrı bir iş kalemi olarak ele alınmalı.

## 5. Piyasa (doğrulanmadı)
SEO tarafında eRank, Marmalead, EverBee; muhasebe tarafında Craftybase gibi rakipler olduğu biliniyor.
Ayrıştırıcılar: gerçek ledger verisiyle seçenek bazında kârlılık, yerel-önce düzenleyici, toplu işlemler. Ayrı piyasa araştırması gerekir.

## 6. Önerilen sıra
1. **Hemen:** Developer Portal'da uygulama türünü kontrol et; Personal App / Commercial Access başvurusunu başlat; ürün adını "Etsy" içermeyecek şekilde belirle; API Terms Bölüm 1'i (önbellek) oku; Portal'da mevcut kotayı not et.
2. **Sertleştirme:** finans için test paketi, güvenlik maddeleri, token şifreleme, PostgreSQL, iş kuyruğu, kota sayacı + 429 yeniden deneme.
3. **Özel beta:** onaylı uygulamayla 5–20 tanıdık satıcı; kota ve ilk kurulum süresini gerçek veriyle ölç.
4. **Sonra:** ödeme sistemi, KVKK metinleri, webhook'a geçiş, herkese açılış.

---

## Ek: Projede açık kalan işler (2026-09-21 itibarıyla)
- **Commit'lenmemiş değişiklikler:** finans denetim düzeltmeleri, sipariş kâr sütunu, sabit sipariş gideri, dijital ürün, çok para birimi, sipariş özet kutusunun kaldırılması. Son push: `6ffe07b`.
- Finans için otomatik test paketi yok (bugünkü doğrulamalar tek seferlik; regresyon kontrolü için 34 sonuçluk bir anlık görüntü betiği geçici klasörde kaldı).
- **Aylık sabit giderler** ekranı bilerek ertelendi ("net kâr" şu an brüt kâr).
- Çok para birimi yalnızca yapay EUR verisiyle test edildi; gerçek EUR/GBP mağazasıyla doğrulanmadı.
- AB satıcısı KDV'sinin ledger'da nasıl göründüğü doğrulanmadı.
- Yerel listing önbelleğinde yalnızca 100 aktif listing var (Etsy'de ~471); 311 satılmış ürünün resmi/başlığı yok. Neden araştırılmadı. İsteğe bağlı: ~311 okuma isteğiyle resimleri çekmek (kullanıcı onayı bekliyor).
- Önceki güvenlik/dayanıklılık denetiminden açık maddeler: kayıt kapatma, giriş sınırı, token şifreleme/hash, yükleme sınırları, Etsy 429 yeniden deneme, günlük kota sayacı, zamanlayıcı ilk çalıştırma.
- Bellek dosyası `listing-editor-draft-architecture.md` güncel değil (eski "Kaydet yok, otomatik taslak" modelini anlatıyor).
