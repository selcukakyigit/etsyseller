from pydantic import BaseModel, Field


class SuggestionOut(BaseModel):
    id: int
    listing_id: int
    original_title: str
    original_tags: list[str]
    original_description: str
    suggested_title: str
    suggested_tags: list[str]
    suggested_description: str
    rationale: str
    status: str
    created_at: str
    applied_at: str | None = None
    # Üretildiği anda formu doldurmak için döner; kalıcı saklanmaz.
    suggested_materials: list[str] = []


class SuggestIn(BaseModel):
    """Formdaki (taslaktaki) güncel değerler; verilirse AI Etsy'deki değil bunları iyileştirir."""

    title: str | None = None
    tags: list[str] | None = None
    description: str | None = None
    materials: list[str] | None = None


class ListingOut(BaseModel):
    listing_id: int
    title: str
    tags: list[str]
    description: str
    url: str | None
    image_url: str | None
    views: int | None
    favorites: int | None
    pending_suggestion: SuggestionOut | None
    # Yerel taslak varsa başlık/etiket/açıklama/görsel taslaktan gelir.
    has_draft: bool = False
    draft_updated_at: str | None = None
    has_local: bool = False  # kaydedilmiş, Etsy'ye henüz gönderilmemiş yerel değişiklik
    local_updated_at: str | None = None
    # Liste kartı / filtreler için özet alanlar
    state: str | None = None
    quantity: int | None = None
    price_min: float | None = None
    price_max: float | None = None
    currency: str | None = None
    skus: list[str] = []
    shop_section_id: int | None = None
    shipping_profile_id: int | None = None
    return_policy_id: int | None = None
    production_partner_ids: list[int] = []
    has_video: bool = False
    should_auto_renew: bool = False
    ending_timestamp: int | None = None
    last_modified_timestamp: int | None = None
    is_new: bool = False  # henüz Etsy'de olmayan, yalnızca yerelde var olan yeni listing


class StatSnapshotOut(BaseModel):
    views: int
    favorites: int
    captured_at: str


class ListingHistoryOut(BaseModel):
    versions: list[SuggestionOut]
    stats: list[StatSnapshotOut]


class ListingUpdateIn(BaseModel):
    """All fields optional — only the ones provided are sent to Etsy."""

    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    materials: list[str] | None = None
    taxonomy_id: int | None = None
    who_made: str | None = None
    when_made: str | None = None
    is_supply: bool | None = None
    shipping_profile_id: int | None = None
    return_policy_id: int | None = None
    shop_section_id: int | None = None
    featured_rank: int | None = None
    should_auto_renew: bool | None = None
    is_taxable: bool | None = None
    item_weight: float | None = None
    item_length: float | None = None
    item_width: float | None = None
    item_height: float | None = None
    item_weight_unit: str | None = None
    item_dimensions_unit: str | None = None
    production_partner_ids: list[int] | None = None
    ecgt_garan_brand: str | None = None
    ecgt_garan_years: int | None = None
    ecgt_garan_model: str | None = None
    ecgt_garan_guarantee_details: str | None = None
    ecgt_other_commercial_guarantee_details: str | None = None
    ecgt_after_sales_service_info: str | None = None
    ecgt_software_update_details: str | None = None
    state: str | None = None  # yalnızca active | inactive yazılabilir


class ListingEditOut(BaseModel):
    """Full editable snapshot of a listing. Etsy's own image/inventory
    structures are passed through as dicts rather than re-modeled field by
    field — see plan notes on why (Etsy's inventory shape is deep and
    actively evolving with third-variation support)."""

    listing_id: int
    title: str
    description: str
    tags: list[str]
    materials: list[str]
    taxonomy_id: int | None
    who_made: str | None
    when_made: str | None
    is_supply: bool
    shipping_profile_id: int | None
    return_policy_id: int | None
    images: list[dict]
    videos: list[dict] = []
    inventory: dict
    properties: list[dict]
    shop_section_id: int | None = None
    featured_rank: int | None = None
    should_auto_renew: bool = False
    is_taxable: bool = True
    item_weight: float | None = None
    item_length: float | None = None
    item_width: float | None = None
    item_height: float | None = None
    item_weight_unit: str | None = None
    item_dimensions_unit: str | None = None
    production_partner_ids: list[int] = []
    ecgt_garan_brand: str | None = None
    ecgt_garan_years: int | None = None
    ecgt_garan_model: str | None = None
    ecgt_garan_guarantee_details: str | None = None
    ecgt_other_commercial_guarantee_details: str | None = None
    ecgt_after_sales_service_info: str | None = None
    ecgt_software_update_details: str | None = None
    # Başlık bilgileri (salt okunur; state hariç yazılabilir)
    state: str | None = None
    listing_type: str | None = None
    url: str | None = None
    original_creation_timestamp: int | None = None
    ending_timestamp: int | None = None


class InventoryUpdateIn(BaseModel):
    products: list[dict]
    price_on_property: list[int] = []
    quantity_on_property: list[int] = []
    sku_on_property: list[int] = []
    readiness_state_on_property: list[int] = []


class PropertyUpdateIn(BaseModel):
    value_ids: list[int]
    values: list[str]
    scale_id: int | None = None


class VariationImagesIn(BaseModel):
    variation_images: list[dict]


class ImageOrderIn(BaseModel):
    image_ids: list[int]


class DraftSaveIn(BaseModel):
    data: dict
    # Yerel kopyanın alındığı Etsy hâli (yalnızca ilk Kaydet'te saklanır; sonrakilerde korunur).
    base: dict | None = None


class PersonalizationOption(BaseModel):
    label: str
    option_id: int | None = None


class PersonalizationQuestion(BaseModel):
    """Etsy "Custom options" alanı: en fazla 5 soru; text_input | dropdown | unlabeled_upload | labeled_upload."""

    question_id: int | None = None
    question_text: str = ""
    instructions: str = ""
    question_type: str = "text_input"
    required: bool = False
    max_allowed_characters: int | None = None
    max_allowed_files: int | None = None
    options: list[PersonalizationOption] = []
    add_on_price: dict | None = None  # Etsy Money nesnesi; olduğu gibi taşınır


MAX_PERSONALIZATION_QUESTIONS = 5


class PersonalizationIn(BaseModel):
    questions: list[PersonalizationQuestion] = Field(default=[], max_length=MAX_PERSONALIZATION_QUESTIONS)


class PersonalizationOut(BaseModel):
    questions: list[PersonalizationQuestion] = []
