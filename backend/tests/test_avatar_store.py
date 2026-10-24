"""Profil fotoğrafı kalıcı depoda durur (Render'ın diski her yayında silinir) ve herkese açık adresten sunulur; eskisi yenisi yüklenince depodan kalkar."""
from io import BytesIO
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.account import service
from app.auth.models import User
from app.core import blobstore


def _png(color=(200, 80, 40)) -> bytes:
    out = BytesIO()
    Image.new("RGB", (40, 20), color).save(out, format="PNG")
    return out.getvalue()


def _user(db) -> User:
    user = User(email="a@b.c", supabase_id="sb-1")
    db.add(user)
    db.commit()
    return user


@pytest.fixture(autouse=True)
def local_store(tmp_path, monkeypatch):
    """Depo yerel klasöre çevrilir: `.env`'de Supabase ayarlı olsa bile test gerçek depoya hiçbir şey yazmaz ya da silmez."""
    monkeypatch.setattr(blobstore, "_remote", lambda: False)
    monkeypatch.setattr(blobstore, "LOCAL_ROOT", tmp_path)


def test_avatar_is_stored_in_the_blob_store_served_publicly_and_replaced(db, tmp_path):
    from app import main

    user = _user(db)
    service.save_avatar(db, user, "me.png", _png())
    first = user.avatar_filename
    assert (tmp_path / "avatars" / first).exists() and user.avatar_url == f"/static/avatars/{first}"

    client = TestClient(main.app)
    resp = client.get(user.avatar_url)
    assert resp.status_code == 200 and resp.headers["content-type"] == "image/png" and "immutable" in resp.headers["cache-control"]
    assert Image.open(BytesIO(resp.content)).size == (512, 512), "kare kırpılıp boyutlandırılır"

    service.save_avatar(db, user, "me2.png", _png((10, 10, 10)))
    assert user.avatar_filename != first and not (tmp_path / "avatars" / first).exists(), "eski fotoğraf depodan kalkar"
    assert client.get(f"/static/avatars/{first}").status_code == 404


def test_avatar_route_rejects_odd_names_and_missing_files():
    from app import main

    client = TestClient(main.app)
    assert client.get("/static/avatars/none-abc.png").status_code == 404
    assert client.get("/static/avatars/..%2Fsecret.png").status_code == 404
    assert client.get("/static/avatars/x.txt").status_code == 404
