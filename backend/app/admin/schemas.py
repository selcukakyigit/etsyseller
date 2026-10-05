from pydantic import BaseModel, Field


class ModelUsageOut(BaseModel):
    provider: str
    model: str
    requests: int
    input_tokens: int
    output_tokens: int


class OverviewOut(BaseModel):
    users_total: int
    users_7d: int
    users_30d: int
    shops_connected: int
    shops_revoked: int
    shops_demo: int
    ai_requests_30d: int
    ai_input_tokens_30d: int
    ai_output_tokens_30d: int
    ai_by_model: list[ModelUsageOut]
    open_messages: int
    etsy_calls_today: int
    etsy_daily_limit: int


class UserShopOut(BaseModel):
    id: int
    shop_name: str
    connected: bool
    is_demo: bool
    revoked: bool
    listings_synced_at: str | None


class AdminUserOut(BaseModel):
    id: int
    email: str
    name: str | None
    avatar_url: str | None
    created_at: str | None
    last_seen_at: str | None
    status: str  # active | suspended | blocked
    status_reason: str | None
    role: str  # user | admin
    env_admin: bool  # ADMIN_EMAILS'ten gelen yönetici: rolü/durumu panelden değişmez
    workspace_id: int | None
    plan: str | None  # canlı aboneliğin plan adı; yoksa ücretsiz
    plan_manual: bool
    credits: int
    ai_enabled: bool
    ai_requests_30d: int
    shops: list[UserShopOut]


class UsersPageOut(BaseModel):
    items: list[AdminUserOut]
    total: int


class LedgerRowOut(BaseModel):
    id: int
    kind: str
    task: str | None
    model: str | None
    credits: int
    delta: int
    note: str
    created_at: str | None


class NoteOut(BaseModel):
    id: int
    author_email: str
    text: str
    created_at: str | None


class UserSubscriptionOut(BaseModel):
    id: int
    product: str | None
    status: str
    manual: bool
    renews_at: str | None
    ends_at: str | None


class UserDetailOut(BaseModel):
    user: AdminUserOut
    balance_plan: int
    balance_purchased: int
    subscriptions: list[UserSubscriptionOut]
    ledger: list[LedgerRowOut]
    notes: list[NoteOut]
    audit: list["AuditOut"]


class UserCreditsIn(BaseModel):
    amount: int = Field(ge=-1_000_000, le=1_000_000)
    bucket: str = Field(default="purchased", pattern="^(plan|purchased)$")
    note: str = Field(default="", max_length=300)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class AssignPlanIn(BaseModel):
    product_id: int
    months: int = Field(ge=1, le=36)


class RoleIn(BaseModel):
    role: str = Field(pattern="^(user|admin)$")


class StatusIn(BaseModel):
    status: str = Field(pattern="^(active|suspended|blocked)$")
    reason: str = Field(default="", max_length=300)


class DeleteUserIn(BaseModel):
    confirm_email: str = Field(min_length=3, max_length=255)


class BulkIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)
    action: str = Field(pattern="^(credits|suspend|activate|block)$")
    amount: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    bucket: str = Field(default="purchased", pattern="^(plan|purchased)$")
    reason: str = Field(default="", max_length=300)


class BulkResultOut(BaseModel):
    user_id: int
    ok: bool
    error: str | None


class AttachmentOut(BaseModel):
    id: int
    filename: str
    size: int


class MessageOut(BaseModel):
    id: int
    name: str
    email: str
    topic: str
    message: str
    lang: str
    handled: bool
    created_at: str | None
    attachments: list[AttachmentOut]


class MessageUpdateIn(BaseModel):
    handled: bool


class AttachmentUrlOut(BaseModel):
    url: str
    filename: str


class JobOut(BaseModel):
    id: str
    next_run: str | None
    last_run: str | None
    last_ok: bool | None
    last_error: str | None


class ShopSyncOut(BaseModel):
    id: int
    shop_name: str
    owner_email: str
    listings_synced_at: str | None
    revoked: bool
    stale: bool


class SystemOut(BaseModel):
    etsy_calls_today: int
    etsy_daily_limit: int
    etsy_background_budget: int
    scheduler_running: bool
    jobs: list[JobOut]
    shops: list[ShopSyncOut]


# ---- Modeller ve anahtarlar

class AiModelOut(BaseModel):
    id: int
    kind: str
    provider: str
    model_id: str
    label: str
    active: bool
    supported: bool  # kodda bu tür için sağlayıcı adaptörü var mı (yoksa göreve atanamaz)
    input_usd_per_mtok: float | None
    output_usd_per_mtok: float | None
    unit_usd: float | None
    options: dict


class AiModelIn(BaseModel):
    kind: str = Field(pattern="^(llm|image|video)$")
    provider: str = Field(min_length=1, max_length=30)
    model_id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._:/@-]+$")
    label: str = Field(min_length=1, max_length=120)
    active: bool = True
    input_usd_per_mtok: float | None = Field(default=None, ge=0, le=10_000)
    output_usd_per_mtok: float | None = Field(default=None, ge=0, le=10_000)
    unit_usd: float | None = Field(default=None, ge=0, le=1_000)
    options: dict = Field(default_factory=dict)


class TaskOut(BaseModel):
    task: str
    kind: str
    name_tr: str
    name_en: str
    model_id: int | None  # atanmış katalog modeli
    effective: str  # şu an gerçekte kullanılan "sağlayıcı/model"


class ProviderKeyOut(BaseModel):
    provider: str
    masked: str
    source: str  # db | env | ""


class CatalogOut(BaseModel):
    models: list[AiModelOut]
    tasks: list[TaskOut]
    keys: list[ProviderKeyOut]
    providers: dict[str, list[str]]  # tür -> desteklenen sağlayıcılar
    from_db: bool  # False: tablolar okunamadı, .env kullanılıyor (göç uygulanmamış olabilir)


class TaskIn(BaseModel):
    model_id: int


class KeyIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=500)


class KeyTestIn(BaseModel):
    api_key: str | None = Field(default=None, max_length=500)


class TestOut(BaseModel):
    ok: bool
    message: str


# ---- Krediler

class CreditSettingsOut(BaseModel):
    credits_enabled: bool
    credit_markup: float
    credit_usd: float
    signup_credits: int


class CreditSettingsIn(BaseModel):
    credits_enabled: bool | None = None
    credit_markup: float | None = Field(default=None, ge=1, le=50)
    credit_usd: float | None = Field(default=None, gt=0, le=10)
    signup_credits: int | None = Field(default=None, ge=0, le=100_000)


class WorkspaceCreditOut(BaseModel):
    workspace_id: int
    name: str
    owner_email: str | None
    plan: int
    purchased: int
    subscription_status: str | None
    used_30d: int


class WorkspaceCreditsPageOut(BaseModel):
    items: list[WorkspaceCreditOut]
    total: int


class AdjustIn(BaseModel):
    amount: int = Field(ge=-1_000_000, le=1_000_000)
    bucket: str = Field(default="purchased", pattern="^(plan|purchased)$")
    note: str = Field(default="", max_length=300)


class UsageRowOut(BaseModel):
    task: str | None
    model: str | None
    calls: int
    cost_usd: float
    credits: int


class UsageReportOut(BaseModel):
    days: int
    rows: list[UsageRowOut]
    total_cost_usd: float
    total_credits: int


# ---- Satış (Lemon Squeezy)

class ProductOut(BaseModel):
    id: int
    kind: str
    name_tr: str
    name_en: str
    variant_id: str
    credits: int
    price_cents: int
    currency: str
    interval: str | None
    active: bool
    sort: int


class ProductIn(BaseModel):
    kind: str = Field(pattern="^(plan|pack)$")
    name_tr: str = Field(min_length=1, max_length=120)
    name_en: str = Field(min_length=1, max_length=120)
    variant_id: str = Field(min_length=1, max_length=40, pattern=r"^[0-9]+$")
    credits: int = Field(ge=1, le=10_000_000)
    price_cents: int = Field(ge=0, le=100_000_000)
    currency: str = Field(default="USD", pattern="^[A-Z]{3}$")
    interval: str | None = Field(default=None, pattern="^(month|year)$")
    active: bool = True
    sort: int = Field(default=0, ge=0, le=1000)


class SubscriptionOut(BaseModel):
    id: int
    workspace_id: int
    owner_email: str | None
    product: str | None
    status: str
    renews_at: str | None
    ends_at: str | None


class BillingEventOut(BaseModel):
    id: int
    event_name: str
    lemon_id: str | None
    workspace_id: int | None
    ok: bool
    error: str | None
    created_at: str | None


class BillingOverviewOut(BaseModel):
    lemon_configured: bool
    webhook_configured: bool
    products: list[ProductOut]
    subscriptions: list[SubscriptionOut]
    events: list[BillingEventOut]


# ---- Kayıt

class AuditOut(BaseModel):
    id: int
    email: str
    action: str
    target: str
    detail: str
    created_at: str | None


UserDetailOut.model_rebuild()
