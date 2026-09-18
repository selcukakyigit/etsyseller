# Etsy SEO + Sipariş Otomasyonu

Etsy mağazasındaki listing'leri çeker, Claude ile SEO açısından optimize edilmiş
başlık/etiket/açıklama önerisi üretir ve onaylanan öneriyi tek tıkla Etsy'ye geri yazar.
Kendi kullanıcı hesabı sistemi (kalıcı oturum) ve çok mağazalı/çok kullanıcılı
(SaaS'a dönüştürülebilir) bir şema üzerine modüler olarak kuruludur.

Ayrıntılı mimari ve yol haritası için: `C:\Users\ADMİN\.claude\plans\wild-waddling-gosling.md`

## Mimari

- `backend/` — FastAPI, domain bazlı modüller halinde:
  - `app/core` — config, DB (SQLAlchemy + Alembic), parola/oturum güvenliği, ortak dependency'ler
  - `app/auth` — kullanıcı kayıt/giriş/çıkış, httpOnly cookie ile kalıcı oturum
  - `app/shops` — Etsy OAuth2 (PKCE) bağlama akışı, çok mağazalı `Shop` modeli
  - `app/etsy` — Etsy API'ye giden TEK istek katmanı (OAuth mekaniği, generic client, listing çağrıları)
  - `app/listings` — listing önerisi üretme/uygulama, versiyon geçmişi (`ListingVersion`)
  - `app/ai` — Claude tabanlı SEO öneri üretimi
  - `app/jobs` — (Faz B) günlük istatistik/sipariş senkronizasyon job'ları
- `frontend/` — Next.js. Giriş/kayıt, mağaza bağlama, listing tablosu + diff görünümü.

## Kurulum

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate   # Windows
pip install -r requirements.txt
cp .env.example .env     # ETSY_API_KEY, ETSY_SHARED_SECRET, ANTHROPIC_API_KEY doldur
alembic upgrade head     # veritabanı şemasını oluşturur
uvicorn app.main:app --reload --port 8000
```

Etsy Developer App'te **Redirect URI** olarak `.env`'deki `ETSY_REDIRECT_URI` değerini
(varsayılan `http://localhost:8000/api/shops/connect/callback`) kayıtlı tutman gerekiyor.
`ETSY_SHOP_ID` artık gerekmiyor — mağaza, kullanıcı Etsy'ye bağlandığında otomatik keşfedilir.

**Şema değiştirdiğinde** (yeni model/alan eklediğinde): `alembic revision --autogenerate -m "..."` ile
migration üret, `alembic upgrade head` ile uygula. Uygulama başlarken şemayı kendiliğinden oluşturmaz.

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

`http://localhost:3000` adresini aç, kayıt ol/giriş yap, "Etsy'ye Bağlan" ile mağazanı yetkilendir.

## Akış

1. Kayıt ol / giriş yap (kendi kullanıcı hesabın, Etsy'den bağımsız) — oturum 90 gün kalıcı.
2. "Etsy'ye Bağlan" → Etsy OAuth (PKCE) → mağaza otomatik keşfedilip hesabına bağlanır.
3. Ana sayfa aktif listing'leri listeler.
4. Bir listing için "AI Önerisi Üret" → Claude yeni başlık/13 etiket/açıklama üretir.
5. Diff görünümünde mevcut vs öneri karşılaştırılır, gerekçe gösterilir.
6. "Tek Tıkla Uygula" → Etsy'ye `PATCH` ile yazılır (her uygulama `ListingVersion` tablosunda kalıcı kayıt olur); "Reddet" ile öneri iptal edilir.

## Yol haritası (plan dosyasında detaylı)

- **Faz B** — günlük istatistik job'ı (APScheduler) + listing geçmişi/performans grafiği
- **Faz C** — sipariş (receipt) senkronizasyonu, durum/kargo takip güncelleme, AI günlük özet
- **Faz D** — keyword havuzu: kendi performans verisi + Etsy rakip/kategori analizi, SEO prompt'una entegrasyon
- **Faz E** — taksonomi/özellik alanları, yorum madenciliği, görsel alt-text, fiyat sinyali
- **Faz F** — 3. parti keyword servisi, toplu işlem + otomatik geri alma uyarısı, çoklu mağaza UI'ı, gerçek SaaS altyapısı
