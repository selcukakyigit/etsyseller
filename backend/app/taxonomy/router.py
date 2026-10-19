from fastapi import APIRouter, Depends

from app.auth.models import User
from app.core.deps import get_current_user
from app.taxonomy import service

router = APIRouter(prefix="/api/taxonomy", tags=["taxonomy"])


@router.get("/nodes")
def nodes(user: User = Depends(get_current_user)):
    return service.cached_nodes()


@router.get("/nodes/{taxonomy_id}/properties")
def properties(taxonomy_id: int, user: User = Depends(get_current_user)):
    return service.cached_properties(taxonomy_id)
