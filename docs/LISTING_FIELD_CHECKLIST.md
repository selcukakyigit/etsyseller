# Listing alanları kontrol listesi (Etsy API ↔ Ulagg formu ↔ asistan)

Amaç: bir listing'in kaç ayrı karar noktası var, hangisini kim (kullanıcı / mağaza alışkanlığı / kategori / ürün) belirler, asistan hangisini
soru sormadan doldurur. Asistan kuralı: **eksik bilgide soru sorma; mağazadan öğren, makul tahmin et, özetin sonunda tek cümleyle söyle.**
Yalnızca gerçekten bilinemeyen şey (fiyat, ürün adı) boş kalır.

## 1. Karar noktaları (fiziksel ürün, ~38 alan)

| Grup | Alan | Kim belirler | Asistan | Etsy API alanı |
|---|---|---|---|---|
| İçerik | Başlık, açıklama, 13 etiket | Kullanıcı tarifi + kelime havuzu | Yazar; kalite denetimi en fazla 2 kez reddeder, sonra uyarıyla oluşturur | `title`, `description`, `tags` |
| İçerik | Kategori | Ürün | Seçer (benzer listing → find_category → seçici model) | `taxonomy_id` |
| İçerik | Malzeme, stil | Resim/tarif | Doldurur | `materials`, `styles` |
| Medya | Fotoğraf (≤20), video (≤2), alt metin | Kullanıcı / üretim | Alt metni yazar; resim üretimi istenirse üretir | images, videos |
| Fiyat | Fiyat, stok, SKU | Kullanıcı | Söylenmediyse boş (tek soru) | `price`, `quantity`, inventory |
| Varyasyon | Renk, beden, boyut (≤3; fiyat tek varyasyonda) | Kullanıcı | Kurar; ölçü yazılışını düzeltir | inventory `property_values` |
| Varyasyon | Seçenek başına fiyat/stok | Kullanıcı | Kurar | `price_on_property`, `quantity_on_property` |
| Kişiselleştirme | Soru metni, zorunlu mu, karakter sınırı | Kullanıcı | Kurar | `is_personalizable`, personalization |
| Mağaza alışkanlığı | İşlem profili (hazırlık süresi) | Mağaza | **Otomatik** (aynı kategori → tüm mağaza) | `readiness_state_id` |
| Mağaza alışkanlığı | Mağaza bölümü | Mağaza + kategori | **Otomatik** (aynı kategori; yoksa bölüm adı ↔ başlık) | `shop_section_id` |
| Mağaza alışkanlığı | Kargo profili, iade politikası | Mağaza | Otomatik (en çok kullanılan) | `shipping_profile_id`, `return_policy_id` |
| Mağaza alışkanlığı | Üretim ortağı | Mağaza | **Otomatik** | `production_partner_ids` |
| Mağaza alışkanlığı | Kim yaptı / ne zaman / tedarik mi | Mağaza | **Otomatik** | `who_made`, `when_made`, `is_supply` |
| Mağaza alışkanlığı | Otomatik yenileme, vergi | Mağaza | Otomatik | `should_auto_renew`, `is_taxable` |
| Kategori özellikleri | Renk, tatil, mekân, desen… | Kategori + resim | Tek amaçlı model doldurur; varyasyonla karşılananı atlar | listing properties |
| Ölçü | Genişlik, yükseklik, derinlik | Ürün | Aşağıda (§2) | properties (sayı + birim) |
| Fiziksel | Ağırlık, boyut, birim | Kullanıcı | Verildiyse yazar | `item_weight`, `item_length`… |
| Yasal | GPSR, gümrük (tarife no) | Kullanıcı | Dokunmaz (düzenleyiciden) | `ecgt_*` |

Kullanıcıdan gelmesi gereken: ürün, fiyat, stok, resim. Geri kalan her şey ya mağazadan ya kategoriden ya üründen türetilir.

## 2. Ölçü kuralları (Genişlik / Yükseklik / Derinlik)

- Etsy'de "Height" gibi bir ölçüyü **varyasyon** yaparsanız aynı ölçünün özellik alanı devre dışı kalır. Biz tek bir **"Size"** varyasyonu kullanıyoruz
  (`35" x 45"` gibi) çünkü Width × Height iki ayrı varyasyon olursa istenmeyen kombinasyonlar (35×70) oluşur.
- "Size" seçenekleri 2 ölçülüyse (A x B) → **Width + Height** varyasyonda sayılır, özelliğe tek değerle yazılmaz. 3 ölçülüyse (A x B x C) → **Depth** de sayılır.
- Varyasyonda olmayan ölçü (çoğu zaman Depth) özellik olarak doldurulur; değer **uydurulmaz**, şu sırayla bulunur:
  1. kullanıcının verdiği ölçü, 2. metinde açıkça yazan kalınlık ("2 mm thickness"), 3. mağazanın aynı kategorideki listing'lerinde en çok kullandığı Depth.
- Yazılış: `35x45`, `35"x45"`, `35 X 45 in`, `50 cm`, `XL Model : 30" x 47"` hepsi anlaşılır; sunucu tek biçime getirir (`35" x 45"`, `35 x 45 cm`).
  Birim yazılmamışsa mağazanın mevcut varyasyonlarındaki alışkanlık (yoksa USD → inç, diğer → cm) varsayılır ve asistan özetin sonunda söyler. Soru sorulmaz.
- Tek sayı (`50`) hangi ölçü olduğu belli olmadığından tahmin edilmez, olduğu gibi kalır.

## 3. Form ↔ API: artı / eksi

| | Artı | Eksi |
|---|---|---|
| Etsy'nin standart varyasyonları (Width, Height…) | Alıcı filtresinde görünür | Çapraz kombinasyon üretir; 2 ölçü + renk = 3 varyasyon sınırı |
| Tek "Size" özel varyasyonu | Tam istediğimiz kombinasyonlar, fiyat tek varyasyonda | Alıcı ölçü filtresinde görünmez (özellik alanı kısmen telafi eder) |
| Yerel kolaylaştırıcı (hızlı ölçü modalı) | `A x B` / `A x B x C` yazınca birim ve etiket otomatik | Etsy'de olmayan arayüz; yalnızca bizde |
| Mağazadan öğrenme | Soru sormadan Etsy'nin "yeni listing" davranışıyla aynı | İlk listing'lerde veri yok → boş kalır, düzenleyiciden seçilir |

## 3b. Varyasyon penceresi (yapıldı)

- **Hızlı ölçü (A x B)** düğmesi: tek "Size" varyasyonu; 2 ya da 3 ölçü + birim (inç/cm/mm/ft/m) girilir, seçenek `35" x 45"` / `35 x 45 cm` olur.
- **Birimli standart varyasyonlar** (Width, Height, Length, Diameter…): Etsy'deki gibi önce Birim seçilir (Centimeters, Feet, Inches, Meters, Millimeters, Yards), seçenekler sayı olarak girilir ve değerin yanında birim görünür.
- Değerli standart varyasyonlar (Primary color, Framing, Orientation…): "Standart seçeneklerden ekle" listesi (zaten vardı).
- Seçenek listesinden aynı adlı tekrarlar ve "Custom Property" yer tutucuları çıkarıldı (Etsy de göstermiyor).
- Asistan aynısını yapar: "Width" adıyla `35 cm` değerleri verirse sunucu birimli standart varyasyona çevirir; `35x45` verirse tek "Size" olur.
