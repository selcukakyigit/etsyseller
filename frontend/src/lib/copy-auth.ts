import type { Lang } from "@/lib/i18n";

export const AUTH_COPY: Record<
  Lang,
  {
    loginTitle: string;
    registerTitle: string;
    forgotTitle: string;
    google: string;
    or: string;
    email: string;
    password: string;
    passwordHint: string;
    agreePre: string;
    terms: string;
    agreeMid: string;
    privacy: string;
    agreePost: string;
    kvkkPre: string;
    kvkk: string;
    kvkkPost: string;
    wait: string;
    submitLogin: string;
    submitRegister: string;
    submitForgot: string;
    forgot: string;
    noAccount: string;
    haveAccount: string;
    registered: string;
    resetSent: string;
    errors: { credentials: string; notConfirmed: string; exists: string; weak: string; rate: string };
    resetTitle: string;
    resetSave: string;
    resetInvalid: string;
    acceptTitle: string;
    acceptLead: string;
    acceptCheck: string;
    acceptBtn: string;
    acceptSaving: string;
    signOut: string;
    ai: string;
  }
> = {
  en: {
    loginTitle: "Sign in to your account",
    registerTitle: "Create your account",
    forgotTitle: "Reset your password",
    google: "Continue with Google",
    or: "or",
    email: "Email",
    password: "Password",
    passwordHint: "at least 8 characters",
    agreePre: "I have read and accept the ",
    terms: "Terms of Service",
    agreeMid: " and the ",
    privacy: "Privacy Policy",
    agreePost: ".",
    kvkkPre: " Turkish residents: ",
    kvkk: "KVKK notice",
    kvkkPost: ".",
    wait: "Please wait…",
    submitLogin: "Sign in",
    submitRegister: "Create account",
    submitForgot: "Send link",
    forgot: "Forgot password?",
    noAccount: "No account yet? Sign up",
    haveAccount: "Already have an account? Sign in",
    registered: "Your account is created. We sent a confirmation link to your email. Click it, then sign in.",
    resetSent: "If this email is registered, a password reset link has been sent.",
    errors: {
      credentials: "Wrong email or password.",
      notConfirmed: "Your email isn't confirmed yet. Click the link in your inbox.",
      exists: "This email is already registered.",
      weak: "Password must be at least 8 characters.",
      rate: "Too many attempts. Try again in a few minutes.",
    },
    resetTitle: "Set a new password",
    resetSave: "Save password",
    resetInvalid: "This link is invalid or has expired. Request a new one from the sign-in page.",
    acceptTitle: "Accept the terms",
    acceptLead: "To continue, please read and accept the documents below (last updated",
    acceptCheck: "I have read and accept the documents above.",
    acceptBtn: "Accept and continue",
    acceptSaving: "Saving…",
    signOut: "Sign out",
    ai: "AI & Data Use",
  },
  tr: {
    loginTitle: "Hesabına giriş yap",
    registerTitle: "Yeni hesap oluştur",
    forgotTitle: "Şifreni sıfırla",
    google: "Google ile devam et",
    or: "veya",
    email: "E-posta",
    password: "Şifre",
    passwordHint: "en az 8 karakter",
    agreePre: "",
    terms: "Kullanım Koşulları",
    agreeMid: "'nı ve ",
    privacy: "Gizlilik Politikası",
    agreePost: "'nı okudum, kabul ediyorum.",
    kvkkPre: " ",
    kvkk: "KVKK Aydınlatma Metni",
    kvkkPost: "'ni okudum.",
    wait: "Bekleyin…",
    submitLogin: "Giriş yap",
    submitRegister: "Hesap oluştur",
    submitForgot: "Bağlantı gönder",
    forgot: "Şifremi unuttum",
    noAccount: "Hesabın yok mu? Kayıt ol",
    haveAccount: "Zaten hesabın var mı? Giriş yap",
    registered: "Hesabın oluşturuldu. E-posta adresine bir doğrulama bağlantısı gönderdik; tıkladıktan sonra giriş yapabilirsin.",
    resetSent: "Bu e-posta kayıtlıysa şifre sıfırlama bağlantısı gönderildi.",
    errors: {
      credentials: "E-posta veya şifre hatalı.",
      notConfirmed: "E-posta adresin henüz doğrulanmadı. Gelen kutundaki bağlantıya tıkla.",
      exists: "Bu e-posta zaten kayıtlı.",
      weak: "Şifre en az 8 karakter olmalı.",
      rate: "Çok fazla deneme yaptın, biraz sonra tekrar dene.",
    },
    resetTitle: "Yeni şifre belirle",
    resetSave: "Şifreyi kaydet",
    resetInvalid: "Bağlantı geçersiz veya süresi dolmuş. Giriş sayfasından yeniden iste.",
    acceptTitle: "Koşulları onayla",
    acceptLead: "Devam etmek için aşağıdaki metinleri okuyup kabul etmen gerekiyor (son güncelleme",
    acceptCheck: "Yukarıdaki metinleri okudum ve kabul ediyorum.",
    acceptBtn: "Kabul et ve devam et",
    acceptSaving: "Kaydediliyor…",
    signOut: "Çıkış",
    ai: "Yapay Zekâ ve Veri İşleme",
  },
};

export function translateAuthError(message: string, lang: Lang): string {
  const e = AUTH_COPY[lang].errors;
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return e.credentials;
  if (m.includes("email not confirmed")) return e.notConfirmed;
  if (m.includes("already registered")) return e.exists;
  if (m.includes("password should be")) return e.weak;
  if (m.includes("rate limit")) return e.rate;
  return message;
}
