from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    etsy_api_key: str = ""
    etsy_shared_secret: str = ""
    etsy_redirect_uri: str = "http://localhost:8000/api/shops/connect/callback"
    # Etsy Webhook Portal'daki uç noktanın "Signing Secret"ı (whsec_...). Boşsa /webhooks/etsy 503 döner.
    etsy_webhook_secret: str = ""
    # Yeni Etsy uygulamasına geçiş süresince ikinci uygulamanın anahtarları ve webhook secret'ı (iki uygulama birlikte
    # çalışır; eski mağazalar eski anahtarla devam eder).
    etsy_api_key_new: str = ""
    etsy_shared_secret_new: str = ""
    etsy_webhook_secret_new: str = ""

    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    # Aşağıdaki AI modeli/anahtarı değerleri yalnızca yedektir: asıl kaynak Yönetim > Modeller (veritabanı, bkz.
    # ai/catalog.py). Katalog boşken bunlarla doldurulur; veritabanı okunamazsa bunlara düşülür.
    # Metin görevlerinin varsayılan sağlayıcısı — "openai" or "anthropic".
    ai_provider: str = "openai"

    # Google AI Studio key — used only for image regeneration ("nano banana" image model).
    # NOT: gemini-2.5-flash-image, Gemini API'de 2 Ekim 2026'da emekliye ayrılıyor — resmi yerine geçen
    # gemini-3.1-flash-image-preview ("Nano Banana 2") kullanılıyor. Değiştirmek istersen Ayarlar'dan
    # (ya da .env'de GOOGLE_IMAGE_MODEL) düzenlenebilir.
    google_api_key: str = ""
    google_image_model: str = "gemini-3.1-flash-image-preview"
    google_image_size: str = "2K"  # "1K" | "2K" | "4K" — yükseldikçe fiyat da artar

    frontend_url: str = "http://localhost:3000"
    # API'nin tarayıcıdan görünen adresi (yerel taslak görsellerinin mutlak URL'leri için).
    api_public_url: str = "http://localhost:8000"
    database_url: str = "sqlite:///./data.db"

    # Supabase: kimlik doğrulama (JWT) + hesap silerken Auth kullanıcısını kaldırmak için.
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""  # yalnızca backend; asla frontend'e verilmez
    supabase_jwks_url: str = ""
    supabase_db_url: str = ""  # yalnızca bilgi amaçlı (.env'de DATABASE_URL asıl bağlantıdır)

    # Etsy belirteçlerini veritabanında şifrelemek için Fernet anahtar(lar)ı (bkz. core/crypto.py). Kaybedilirse tüm
    # mağazaların Etsy bağlantısı yeniden kurulmalıdır — güvenli bir yerde yedekle.
    token_encryption_key: str = ""

    # İletişim formu bildirimi (Resend, isteğe bağlı): ayarlı değilse mesajlar yalnızca veritabanına yazılır.
    # RESEND_FROM doğrulanmış bir alan adından olmalı, örn. "Ulagg <noreply@ulagg.com>"; CONTACT_TO bildirimi alacak adres(ler).
    resend_api_key: str = ""
    resend_from: str = ""
    contact_to: str = ""

    # /docs, /redoc, /openapi.json yalnızca yerelde açık (üretimde uç nokta haritası saldırgana verilmez).
    expose_docs: bool = False

    # Virgülle ayrılmış e-postalar: yönetim paneline (/admin) yalnızca bunlar girebilir.
    admin_emails: str = ""

    # Lemon Squeezy (ödeme). API anahtarı ve mağaza no. ödeme sayfası açmak, webhook sırrı gelen olayları doğrulamak için.
    # Boşsa satın alma düğmeleri görünmez, /webhooks/lemonsqueezy 503 döner.
    lemonsqueezy_api_key: str = ""
    lemonsqueezy_store_id: str = ""
    lemonsqueezy_webhook_secret: str = ""

    # Kayıtta kabul edilen hukuki metin sürümü (frontend src/lib/legal.ts içindeki LEGAL_VERSION ile aynı olmalı).
    legal_version: str = "2026-10-02"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
