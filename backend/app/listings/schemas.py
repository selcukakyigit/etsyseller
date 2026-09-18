from pydantic import BaseModel


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
