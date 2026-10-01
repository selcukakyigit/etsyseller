from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    email: str
    name: str | None
    avatar_url: str | None
    is_admin: bool = False
    # Kullanıcının kabul ettiği son hukuki metin sürümü; güncel sürümle farklıysa frontend onay ekranı gösterir.
    consent_version: str | None = None
    needs_consent: bool = True


class ConsentIn(BaseModel):
    version: str
