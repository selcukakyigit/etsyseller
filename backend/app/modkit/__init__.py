"""Modül çekirdeği (modkit): her işletme modülünün (Dış Tedarik, ileride Ambalaj…) üstüne kurulduğu ortak motorlar.

Modüller sektör bilmez; yalnızca bu çekirdeğin nesnelerini kullanır:

- `ModuleEntity`  — modül içindeki bir kayıt (ör. "ABC Lazer" tedarikçisi). Diğer her şey ona yabancı anahtarla bağlanır,
                    kayıt silinince bağlı satırlar veritabanında zincirleme silinir.
- `units`         — birimler ve dönüşüm (sn/dk/saat, g/kg/ton, adet/tabaka…).
- `pricebook`     — fiyat listesi: kalem + birim + tarihli fiyat sürümleri (eski işler eski fiyatla kalır).
- `pricing`       — iş satırlarından tahmini tutar (kalem fiyatı × miktar + sabit ücret + minimum).
- `analyzer`      — belge → yapılandırılmış veri; en ucuz yoldan başlar (kural → metin+AI → görüntü+AI), önbellekli.
- `documents`     — modül kaydına bağlı belge dosyaları.
- `sharing`       — e-posta daveti ve kayıt düzeyinde erişim (ör. tedarikçinin kendi kaydını görmesi).
- `access`        — her uç noktanın geçtiği yetki kontrolü.
- `activity`      — kim neyi ne zaman değiştirdi (hem akış hem denetim kaydı).
- `ratelimit`     — bellek içi kayan pencere sınırlayıcı.
"""
