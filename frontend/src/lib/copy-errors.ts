import type { Lang } from "@/lib/i18n";

export type StatusCode = 401 | 403 | 404 | 500 | 503;

export const STATUS_COPY: Record<StatusCode, Record<Lang, { title: string; message: string }>> = {
  401: {
    en: { title: "Please sign in", message: "You need to sign in to see this page." },
    tr: { title: "Giriş yapman gerekiyor", message: "Bu sayfayı görmek için giriş yapmalısın." },
  },
  403: {
    en: { title: "No access", message: "Your account doesn't have permission to open this page." },
    tr: { title: "Erişim yok", message: "Hesabının bu sayfayı açma yetkisi yok." },
  },
  404: {
    en: { title: "Page not found", message: "The page you're looking for doesn't exist or has moved." },
    tr: { title: "Sayfa bulunamadı", message: "Aradığın sayfa yok ya da taşınmış olabilir." },
  },
  500: {
    en: { title: "Something went wrong", message: "An unexpected error happened on our side. Try again, and if it keeps happening, let us know." },
    tr: { title: "Bir şeyler ters gitti", message: "Bizim tarafımızda beklenmeyen bir hata oldu. Tekrar dene, sürerse bize haber ver." },
  },
  503: {
    en: { title: "Temporarily unavailable", message: "We're having trouble right now. Please try again in a moment." },
    tr: { title: "Geçici olarak ulaşılamıyor", message: "Şu an bir sorun yaşıyoruz. Lütfen biraz sonra tekrar dene." },
  },
};

export const STATUS_ACTIONS: Record<Lang, { home: string; retry: string; contact: string; signin: string; code: string }> = {
  en: { home: "Go to homepage", retry: "Try again", contact: "Contact support", signin: "Sign in", code: "Error code" },
  tr: { home: "Ana sayfaya dön", retry: "Tekrar dene", contact: "Destekle iletişime geç", signin: "Giriş yap", code: "Hata kodu" },
};
