import datetime as dt

import httpx
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.workspaces import primary_workspace
from app.core.config import settings
from app.core.security import generate_token
from app.etsy import oauth as etsy_oauth
from app.etsy.client import API_BASE
from app.shops.models import OAuthState, OAuthToken, Shop


class ShopConnectError(Exception):
    pass


OAUTH_STATE_TTL = dt.timedelta(minutes=10)


def start_connect(db: Session, user: User) -> str:
    pkce = etsy_oauth.generate_pkce()
    state = generate_token()
    workspace = primary_workspace(db, user)
    db.add(OAuthState(state=state, user_id=user.id, workspace_id=workspace.id, code_verifier=pkce.code_verifier))
    db.commit()
    return etsy_oauth.build_authorize_url(state, pkce.code_challenge)


def complete_connect(db: Session, code: str, state: str) -> Shop:
    oauth_state = db.get(OAuthState, state)
    if oauth_state is None or dt.datetime.utcnow() - oauth_state.created_at > OAUTH_STATE_TTL:
        if oauth_state is not None:
            db.delete(oauth_state)
            db.commit()
        raise ShopConnectError("Bilinmeyen ya da süresi dolmuş bağlantı isteği. Tekrar deneyin.")

    token_set = etsy_oauth.exchange_code(code, oauth_state.code_verifier)
    etsy_user_id = int(token_set.access_token.split(".")[0])

    headers = {
        "x-api-key": f"{settings.etsy_api_key}:{settings.etsy_shared_secret}",
        "Authorization": f"Bearer {token_set.access_token}",
    }
    resp = httpx.get(f"{API_BASE}/users/{etsy_user_id}/shops", headers=headers, timeout=30)
    if resp.is_error:
        raise ShopConnectError(f"Etsy mağaza bilgisi alınamadı: {resp.text}")
    shop_data = resp.json()

    shop = db.query(Shop).filter_by(etsy_shop_id=shop_data["shop_id"]).one_or_none()
    if shop is not None and shop.workspace_id != oauth_state.workspace_id:
        raise ShopConnectError("Bu Etsy mağazası başka bir hesaba bağlı. Önce o hesaptan bağlantıyı kaldırın.")
    if shop is None:
        shop = Shop(
            user_id=oauth_state.user_id,
            workspace_id=oauth_state.workspace_id,
            etsy_shop_id=shop_data["shop_id"],
            etsy_user_id=etsy_user_id,
            shop_name=shop_data["shop_name"],
            icon_url=shop_data.get("icon_url_fullxfull"),
        )
        db.add(shop)
        db.flush()
    else:
        shop.shop_name = shop_data["shop_name"]
        if shop_data.get("icon_url_fullxfull"):
            shop.icon_url = shop_data["icon_url_fullxfull"]

    expires_at = dt.datetime.utcnow() + dt.timedelta(seconds=token_set.expires_in)
    shop.access_revoked_at = None  # yeniden bağlandı: erişim geri geldi
    if shop.oauth_token is None:
        db.add(
            OAuthToken(
                shop_id=shop.id,
                access_token=token_set.access_token,
                refresh_token=token_set.refresh_token,
                expires_at=expires_at,
            )
        )
    else:
        shop.oauth_token.access_token = token_set.access_token
        shop.oauth_token.refresh_token = token_set.refresh_token
        shop.oauth_token.expires_at = expires_at

    db.delete(oauth_state)
    db.commit()
    db.refresh(shop)
    return shop
