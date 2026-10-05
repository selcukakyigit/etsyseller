from pydantic import BaseModel


class ProfileUpdateIn(BaseModel):
    name: str | None = None


class DangerIn(BaseModel):
    """Geri alınamaz işlemler için: hesabın e-postasını yazarak onay + "onaylıyorum" işareti (ikisi de zorunlu).
    Şifre doğrulaması Supabase tarafında olduğundan burada e-posta yazdırılır."""

    email: str
    confirm: bool = False
