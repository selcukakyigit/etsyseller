from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    email: str
    name: str | None
    avatar_url: str | None
    is_admin: bool = False
    # active | suspended | blocked — aktif değilse ön yüz bilgi ekranı gösterir (diğer uç noktalar 403 döner).
    status: str = "active"
    # Kullanıcının kabul ettiği son hukuki metin sürümü; güncel sürümle farklıysa frontend onay ekranı gösterir.
    consent_version: str | None = None
    needs_consent: bool = True


class ConsentIn(BaseModel):
    version: str
