"""Supabase Auth e-posta şablonlarını ortak şablondan (app/emails/templates) üretir.

Çalıştır:  python scripts/build_supabase_emails.py
Çıktı:     docs/email-templates/*.html  (Supabase > Authentication > Emails > Templates alanlarına yapıştırılır)
"""
import os
import sys
from pathlib import Path

os.environ["FRONTEND_URL"] = "https://ulagg.com"  # şablonlar Supabase'e yapıştırılır: logo canlı adresten gelmeli

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.emails.renderer import render  # noqa: E402

OUT = ROOT / "docs" / "email-templates"
URL = "{{ .ConfirmationURL }}"
IGNORE_EN = "If you didn't ask for this, you can safely ignore this email."
IGNORE_TR = "Bunu sen istemediysen bu e-postayı güvenle yok sayabilirsin."

# dosya adı -> (Supabase konu satırı, [İngilizce parça, Türkçe parça])
TEMPLATES = {
    "confirm_signup": (
        "Confirm your Ulagg account / Ulagg hesabını doğrula",
        [
            dict(heading="Confirm your email", body="Thanks for signing up for Ulagg. Confirm your email address to finish creating your account.", button="Confirm email", url=URL, note=IGNORE_EN),
            dict(heading="E-postanı doğrula", body="Ulagg'a kayıt olduğun için teşekkürler. Hesabını tamamlamak için e-posta adresini doğrula.", button="E-postayı doğrula", url=URL, note=IGNORE_TR),
        ],
    ),
    "recovery": (
        "Reset your Ulagg password / Ulagg şifreni sıfırla",
        [
            dict(heading="Reset your password", body="We received a request to reset your password. Use the button below to choose a new one. The link expires soon.", button="Choose a new password", url=URL, note=IGNORE_EN),
            dict(heading="Şifreni sıfırla", body="Şifreni sıfırlama isteği aldık. Yeni bir şifre belirlemek için aşağıdaki düğmeyi kullan. Bağlantının süresi kısa sürede dolar.", button="Yeni şifre belirle", url=URL, note=IGNORE_TR),
        ],
    ),
    "magic_link": (
        "Your Ulagg sign-in link / Ulagg giriş bağlantın",
        [
            dict(heading="Sign in to Ulagg", body="Use the button below to sign in. The link works once and expires soon.", button="Sign in", url=URL, note=IGNORE_EN),
            dict(heading="Ulagg'a giriş yap", body="Giriş yapmak için aşağıdaki düğmeyi kullan. Bağlantı tek kullanımlıktır ve kısa sürede dolar.", button="Giriş yap", url=URL, note=IGNORE_TR),
        ],
    ),
    "email_change": (
        "Confirm your new email / Yeni e-postanı doğrula",
        [
            dict(heading="Confirm your new email", body="You asked to change the email address on your Ulagg account to {{ .NewEmail }}. Confirm the change below.", button="Confirm change", url=URL, note=IGNORE_EN),
            dict(heading="Yeni e-postanı doğrula", body="Ulagg hesabındaki e-posta adresini {{ .NewEmail }} olarak değiştirmek istedin. Değişikliği aşağıdan onayla.", button="Değişikliği onayla", url=URL, note=IGNORE_TR),
        ],
    ),
    "invite": (
        "You're invited to Ulagg / Ulagg'a davet edildin",
        [
            dict(heading="You're invited", body="You have been invited to join Ulagg. Accept the invitation to create your account.", button="Accept invitation", url=URL, note=IGNORE_EN),
            dict(heading="Davet edildin", body="Ulagg'a katılman için davet edildin. Hesabını oluşturmak için daveti kabul et.", button="Daveti kabul et", url=URL, note=IGNORE_TR),
        ],
    ),
    "reauthentication": (
        "Your Ulagg confirmation code / Ulagg doğrulama kodun",
        [
            dict(heading="Confirm it's you", body="Enter this code to confirm the action.", code="{{ .Token }}", note=IGNORE_EN),
            dict(heading="Sen olduğunu doğrula", body="İşlemi onaylamak için bu kodu gir.", code="{{ .Token }}", note=IGNORE_TR),
        ],
    ),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["# Supabase e-posta şablonları\n", "Üretildi: `python backend/scripts/build_supabase_emails.py`. Supabase > Authentication > Emails > Templates.\n",
             "| Şablon | Konu satırı |\n|---|---|"]
    for name, (subject, parts) in TEMPLATES.items():
        markup, _ = render("auth_action.html", title=subject, preheader=parts[0]["heading"], parts=parts)
        (OUT / f"{name}.html").write_text(markup, encoding="utf-8")
        lines.append(f"| `{name}.html` | {subject} |")
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("üretildi:", ", ".join(TEMPLATES))
