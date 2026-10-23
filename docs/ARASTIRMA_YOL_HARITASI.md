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

## 2. Discover (kullanıcının araştırma ekranı)
- Ana menüde "Keşfet": tohum kelime → öneriler (Labs) + hacim bantları + kalabalık uyarısı; sonuç havuza kalıcı yazılır (aynı tohum ikinci kullanıcıda sağlayıcıya gitmez).
- Kullanıcıya ham sayı değil bant (düşük/orta/yüksek talep) ve türetilmiş bilgi.
- Kaydet / koleksiyon, listing'e aktar.
- Maliyet: mağaza başı günlük arama kotası (`research_shop_daily_jobs`), ileride kredi.
- Asistan aracı aynı backend işlevini (`research.service.expand`) çağırır (CLAUDE.md kuralı).

## 3. Trends yerine Google Ads geçmişi
- `pytrends`, `trend_cache`, `demand_trends`, `keywords/trends.py`, `insights/demand.py`, listing satırındaki "G:" skoru kaldırılır.
- `diagnosis.py` yıllık değişimi 24 aylık Google Ads geçmişinden (`date_from`) hesaplar; maliyet artışı gösterilir. Davranış değişikliği: kullanıcıya önceden gösterilir.

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
