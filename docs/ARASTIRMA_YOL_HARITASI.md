# Araştırma havuzu — yol haritası

Durum (2026-10-23): Aşama 1 ve kalabalık sayacı canlıda (`app/research/`, göç 0058–0059). Aşağıdakiler sırayla yapılacak işlerdir.

## 1. Öneri kalitesini ölçme — YAZILDI (2026-10-23): veri toplanıyor, puana henüz etkisi YOK
`research/outcomes.py`, tablo `phrase_outcomes` (göç 0060), gece işi `research_signals`; yönetimde Keyword Explorer > kelime detayı > "Öneri sinyalleri". Ölçüm `insights/impact.py`'den gelir (yeniden yazılmadı). Yeterli veri birikince puana bağlanır.

Aşağıdaki tasarım notu:
Amaç: önerilen ifade gerçekten işe yarıyor mu, havuzda ağırlığı buna göre değişsin.
- **Kabul oranı:** öneri uygulandı mı, geri alındı mı, hangi etiketler tutuldu (`listing_versions`, `listing_changes`).
- **Sıra:** önerilen ifade takipteyse sıra değişimi (`rank_snapshots`).
- **Sonuç:** uygulamadan sonra görüntülenme/sipariş değişimi; aynı mağazadaki dokunulmamış listing'lerle kıyaslı (mevsim etkisini azaltır). Pencere ve kıyas mantığı `listing_health` ile aynı olmalı, ikinci bir hesap yazılmaz.
- **Arama terimi kanıtı:** ifade listing'e ziyaret/sipariş getirdi mi (`etsy_keyword_data` search_terms).
- Çıktı: ifade başına yalnızca sayılar (kaç mağazada denendi / kaçında işe yaradı), ortak tablo, mağaza kimliği yok. Puanda "sonuçla kanıtlanmış" ağırlığı; sürekli etkisiz çıkan ifade düşer.
- Sınır: nedensellik kanıtlanamaz (sezon, fiyat, reklam); sonuç "güven puanı" olarak sunulur, kesin iddia edilmez.

## 2. Keşfet (Discover) — YAZILDI (2026-10-24, v1)
- Ekran `/discover` (ana menüde "Keşfet"): tohum kelime → öneriler (Labs Keyword Suggestions, tohumun kendi verisi aynı istekte) + talep bandı (düşük/orta/yüksek) + alıcı niyeti + ⚑ kalabalık + "Sende var" işareti; kaydet / koleksiyon / çıkar. Sonuç havuza kalıcı yazılır; aynı kelime ikinci kullanıcıda sağlayıcıya gitmez.
- Ham arama sayısı/CPC kullanıcıya dönmez (yalnızca bant). Mağaza başı günlük YENİ araştırma kotası `research_shop_daily_searches` (15; havuzda hazır aramalar sayılmaz); yönetimde ayarlanır.
- Kaydedilenler kiracı verisidir (`saved_keywords`, çalışma alanına bağlı, göç 0063); ölçümler gösterilirken ortak havuzdan okunur.
- Asistan: `research_keywords`, `saved_keywords`, `save_keywords` (`assistant/toolsets/research.py`; ekranla AYNI `research/discover.py` işlevleri; kredi harcamaz).
- v1'de YOK: "listing'e aktar", sıra takibine alma, trend yönü (yıllık değişim) ve ek pazarlar. Kredi karşılığı arama.
- Eski not (tasarım):
- Ana menüde "Keşfet": tohum kelime → öneriler (Labs) + hacim bantları + kalabalık uyarısı; sonuç havuza kalıcı yazılır (aynı tohum ikinci kullanıcıda sağlayıcıya gitmez).
- Kullanıcıya ham sayı değil bant (düşük/orta/yüksek talep) ve türetilmiş bilgi.
- Kaydet / koleksiyon, listing'e aktar.
- Maliyet: mağaza başı günlük arama kotası (`research_shop_daily_jobs`), ileride kredi.
- Asistan aracı aynı backend işlevini (`research.service.expand`) çağırır (CLAUDE.md kuralı).

## 3. Trends: pytrends kaldırıldı — YAZILDI (2026-10-23)
- Yeni: DataForSEO Google Trends (`keywords_data/google_trends/explore/live`, istek başına ~0,011 $, en fazla 5 kelime) havuzun kuyruk/önbellek/bütçe düzeninde (`keyword_trends`, göç 0061, iş türü `trend`, TTL 7 gün, haftalık iş `research_trends` takipteki aramaları yeniler). Teşhis (`diagnosis.demand_signal`) havuzdan YALNIZCA okur.
- Silindi: `pytrends`, `keywords/trends.py`, `keywords/models.py` (TrendCache), `insights/demand.py`, `jobs/demand_trends.py`, DemandTrend modeli, `/keyword-pool/trends` uç noktası, "Google Trend Ekle" düğmesi.
- Kullanıcıya görünen değişiklik: kelime havuzunda "G:" artık düğmesiz, otomatik ve ham 0–100 skor yerine talep bandı (düşük/orta/yüksek); ⚑ = kalabalık. Ham Google hacmi/CPC/mağaza sayısı kullanıcıya dönmez (`keywords.service.public_pool`).
- Eski `trend_cache` ve `demand_trends` tabloları, yeni sürüm yayında doğrulandıktan sonra göç 0062 ile silindi (canlı API'de `/trends` yolunun 404 döndüğü ve Vercel derlemesinin başarılı olduğu kontrol edildi).

## 4. Kalıcı bulgular
- `audit.Finding` kalıcı olur: bulgu kimliği, listing sürümü, analiz sürümü, durum (açık/uygulandı/çözüldü/geçersiz). Yalnızca kontrol ya da yeni analiz kapatır, LLM kapatmaz.
- `ListingHealth` ile tek modelde birleşir (iki ayrı gerçek kaynağı olmaz).
- Skor algoritması sürümlenir; eski raporlar geriye dönük değişmez.

## 5. İstek içindeki Etsy rekabet çağrısı
- `keywords/competition.attach_results` (istek başına ~36 Etsy çağrısı) kuyruğa/havuza taşınır; Etsy kotası ortak olduğu için ölçekte sorun.

## 6. Altyapı ve kalite
- İş kuyruğunu ayrı worker'a taşıma (tetikleyici: bellek ~400 MB, ~20–30 aktif mağaza; bkz. ölçekleme planı).
- Otomatik testler: bayat cache, sağlayıcı zaman aşımı, tekrarlı iş, bulgu kapanması, kalabalık sayacı.
- İş türü başına bütçe tavanı; takipteki kelimelerin havuz yenilemesine bağlanması; ek pazarlar (TR, GB, DE…).
- Kalabalık sayacı yalnızca `create_suggestion` önerilerini sayar; toplu yeniden yazım ve taslak yolları da eklenmeli.

## Sonraya (kullanım verisi görülünce)
Soru/niyet havuzu, SERP ve rakip anlık görüntüleri, AI görünürlüğü (LLM Responses/Mentions), kelime birleştirme/kümeleme.

## Veri kaynakları değerlendirmesi (2026-10-23)
Katman sırası: (1) Etsy'nin kendi verisi (Open API sonuç sayısı, kullanıcının yapıştırdığı Marketplace Insights, mağazaların kendi listing/arama terimi/satış verisi) çekirdek gerçektir; (2) DataForSEO Google talebi, mevsimsellik, niyet; (3) Pinterest Trends; (4) kullanıcı verisinden izinli, toplulaştırılmış "damıtma"; (5) ileride Google resmî Trends API ve Google Ads API (maliyet düşürmek için).
- **pytrends ölü:** depo Nisan 2025'te arşivlendi; üretimde buna bağlı yer var → kaldırılmalı (madde 3). Yerine DataForSEO'nun Google Trends uç noktası (aynı hesap) ya da Google'ın resmî Trends API'si (alpha, yalnızca başvuruyla; başvurulabilir).
- **Pinterest Trends API:** resmî, trend kelimeler + haftalık/aylık/yıllık büyüme, bölge bazlı, en fazla 50 sonuç, geçmiş yok (her gün kendimiz kaydetmeliyiz); erişim başvuru/inceleme ister. Etsy kategorileri (ev dekoru, düğün, hediye) için öncü mevsim sinyali. Başvurulacak.
- **Etsy'ye özgü hacim için kamuya açık API yok:** eRank, Marmalead, EverBee vb. için doğrulanmış genel API bulunamadı; kazıma Etsy kurallarına ve hesabımıza (Etsy uygulaması satış hesabında) risk. Kullanılmayacak.
- **Google Ads API (Keyword Planner):** DataForSEO'nun altındaki aynı veri; geliştirici belirteci (yönetici hesap) + Basic erişim + faturalama yöntemi ister, hız sınırlı. Ölçekte maliyeti düşürebilir; reklam harcaması olmayan hesapta aralıklı (kaba) hacim dönebilir (doğrulanacak). Şimdilik gereksiz karmaşıklık.
- Doğrulanacaklar: Etsy API Şartları'nda satıcılar arası toplulaştırma/önbellek sınırları (Bölüm 1 okunmadı); DataForSEO uç nokta adları (Trends, autocomplete) uygulamadan önce.

## Testler ve açık riskler (2026-10-24)
- Otomatik testler repoda: `backend/tests/` (pytest, `requirements-dev.txt`). Çalıştırma: `cd backend && .venv/Scripts/python -m pytest tests` (~3 sn). Testler ASLA gerçek veritabanına ya da sağlayıcıya dokunmaz (geçici SQLite + sahte sağlayıcı; `conftest.py` bunu doğrular).
- Gerçek Postgres'e özgü yollar (SKIP LOCKED, kısmi benzersiz dizin, SQL farkları) için elle doğrulama yöntemi: tek işlem içinde sahte sağlayıcıyla çalıştırıp geri almak (bkz. oturum notları, 2026-10-24).
- **AÇIK RİSK — Etsy API Şartları doğrulanamadı.** Resmî sayfa otomatik erişime 403 veriyor; yalnızca 2020 öncesi arşiv sürümünün alıntıları görüldü (ilan içeriği en fazla 6 saat, diğer içerik 24 saat, "gereğinden uzun saklanmaz", Etsy kullanıcı verisi başka kaynaklarla rıza olmadan birleştirilmez). Havuz, mağaza ilan etiketlerinden ve Etsy aramasındaki rakip etiketlerinden türeyen KELİME metinlerini (mağaza/ilan kimliği olmadan) saklıyor ve sağlayıcıya (DataForSEO) gönderiyor. Kelimeler genel ifadeler, ama bu kullanımın güncel şartlara uygunluğu Bölüm 1'den okunarak ya da developer@etsy.com'a sorularak teyit edilmeli. Kapatma anahtarı: Yönetim > Araştırma > "Araştırma açık".


## Etsy API sırası ≠ sitedeki alıcı sırası (2026-10-24, ÖLÇÜLDÜ)

Etsy API'si (`/listings/active`) yalnızca `sort_on=score` verir; "Most relevant" yoktur. `buyer_country=US` ilan kümesini süzer ama sıralamayı değiştirmez.
Karşılaştırma (ABD VPN, Etsy sitesi, Most relevant) ve sistemin sıra takibi:

- "metal wall decor": sitede 1. sıradaki Family Tree ilanı API'nin ilk 100'ünde yok; API'nin ilk sıraları favorisi 0-4 olan yeni ilanlar.
- Kendi ilanımız: "personalized metal farm sign" sitede 1. (ama "Ad" etiketli), API'de 55. · "large farm sign" sitede 5., API'de 127. · "custom farm sign" API'de 200+.
- Sitede yorumu/satışı/reklamı olan ilanlar önde; API'de yeni ve etkileşimi düşük ilanlar önde. Sitedeki ilk sıra reklam olabilir.

Sonuç ve alınan önlemler:
- Sıra takibi (insights/rank.py) sayıları "API sırası" olarak etiketlenir; ▲▼ renksizdir; teşhis (diagnosis.rank_signal) ondan hüküm (bad/good) ya da görünürlük/çekicilik oyu üretmez; asistan "kesin sıra" demez.
- Keşfet'teki Etsy pencereleri (etsy_top.py) "ilk 20" değil "20 ilanlık örnek"; rekabet gücü (düşük/orta/yüksek) hükmü kaldırıldı. Güvenilir olan: toplam ilan sayısı (sıralamadan bağımsız).
- Gerçek sonuç göstergeleri: günlük görüntülenme/favori (ListingStatSnapshot, Değişiklikler sekmesi) ve kullanıcının yapıştırdığı Etsy arama terimleri (Etsy verisi sekmesi).
- Etsy sitesini proxy ile taramak (scraping) YAPILMAZ: şartlara aykırı ve Etsy API anahtarını (tüm ürünün anahtarı) riske atar. Ekran görüntüsü yükleme/eklenti fikirleri değerlendirildi, şimdilik yapılmadı.
- Açık soru: Etsy'nin (developer@etsy.com) resmi bir sıralama verisi sunup sunmadığı sorulabilir.
