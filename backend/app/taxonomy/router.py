from fastapi import APIRouter, Depends

from app.auth.models import User
from app.core.deps import get_current_user
from app.core.ttl_cache import cached
from app.taxonomy import service

router = APIRouter(prefix="/api/taxonomy", tags=["taxonomy"])


@router.get("/nodes")
def nodes(user: User = Depends(get_current_user)):
    return cached(("tax", "nodes"), service.get_seller_taxonomy_nodes)


@router.get("/nodes/{taxonomy_id}/properties")
def properties(taxonomy_id: int, user: User = Depends(get_current_user)):
    return cached(("tax", "props", taxonomy_id), lambda: service.get_properties_by_taxonomy_id(taxonomy_id))
