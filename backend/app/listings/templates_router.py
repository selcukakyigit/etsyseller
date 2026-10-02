from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.listings import templates
from app.shops.deps import get_owned_shop
from app.shops.models import Shop

router = APIRouter(prefix="/api/shops/{shop_id}/description-templates", tags=["description-templates"])


class TemplateIn(BaseModel):
    name: str = Field(max_length=templates.NAME_MAX)
    body: str = Field(max_length=templates.BODY_MAX)
    is_default: bool = False


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, max_length=templates.NAME_MAX)
    body: str | None = Field(default=None, max_length=templates.BODY_MAX)
    is_default: bool | None = None


class DeleteIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=templates.MAX_TEMPLATES)


class ApplyIn(BaseModel):
    """Editördeki listing'in o anki hâli: açıklama, başlık, malzemeler ve envanter (varyasyonlar için)."""
    description: str = ""
    title: str = ""
    materials: list[str] = []
    inventory: dict | None = None


def _bad(exc: templates.TemplateError) -> HTTPException:
    return HTTPException(404 if "bulunamadı" in str(exc) else 400, str(exc))


@router.get("")
def list_templates(shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return {"templates": [templates.out(t) for t in templates.list_templates(db, shop)], "placeholders": list(templates.PLACEHOLDERS)}


@router.post("")
def create_template(payload: TemplateIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return templates.out(templates.create(db, shop, payload.name, payload.body, payload.is_default))
    except templates.TemplateError as exc:
        raise _bad(exc) from exc


@router.patch("/{template_id}")
def edit_template(template_id: int, payload: TemplatePatch, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    try:
        return templates.out(templates.edit(db, shop, template_id, payload.name, payload.body, payload.is_default))
    except templates.TemplateError as exc:
        raise _bad(exc) from exc


@router.post("/delete")
def delete_templates(payload: DeleteIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    return {"deleted": templates.delete_many(db, shop, payload.ids)}


@router.post("/{template_id}/apply")
def apply_template(template_id: int, payload: ApplyIn, shop: Shop = Depends(get_owned_shop), db: Session = Depends(get_db)):
    """Şablonu editördeki açıklamaya uygular ve yeni metni döner (kaydetmez; editör taslağa kendisi yazar)."""
    try:
        run = templates.applier(db, shop, templates.get(db, shop, template_id))
    except templates.TemplateError as exc:
        raise _bad(exc) from exc
    return {"description": run(payload.model_dump())}
