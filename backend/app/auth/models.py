import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class User(Base):
    """Uygulama içi kullanıcı kaydı. Kimlik doğrulama (şifre, Google, e-posta doğrulama) Supabase Auth'tadır;
    bu satır ilk geçerli girişte `supabase_id` ile otomatik oluşturulur (bkz. core/deps.py)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    supabase_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Google gibi sağlayıcıdan gelen profil fotoğrafı; kullanıcı kendi fotoğrafını yüklemediyse bu gösterilir.
    picture_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    shops: Mapped[list["Shop"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    memberships: Mapped[list["WorkspaceMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    consents: Mapped[list["UserConsent"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def avatar_url(self) -> str | None:
        if self.avatar_filename:
            return f"/static/avatars/{self.avatar_filename}"
        return self.picture_url


class Workspace(Base):
    """Müşteri hesabı / çalışma alanı. Mağazalar bir kullanıcıya değil çalışma alanına aittir; ekip üyeleri
    `WorkspaceMember` ile eklenir."""

    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    members: Mapped[list["WorkspaceMember"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    shops: Mapped[list["Shop"]] = relationship(back_populates="workspace")


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="owner")  # owner | admin | editor | viewer
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    workspace: Mapped["Workspace"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")


class UserConsent(Base):
    """Hangi kullanıcı hangi hukuki metin sürümünü ne zaman, hangi IP'den kabul etti (ispat kaydı)."""

    __tablename__ = "user_consents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(20))
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    accepted_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="consents")
