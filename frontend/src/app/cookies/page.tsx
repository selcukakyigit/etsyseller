import type { Metadata } from "next";
import LegalLayout, { H2, P, Table } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: `Çerez Politikası — ${BRAND}` };

export default function CookiesPage() {
  return (
    <LegalLayout
      title="Çerez Politikası"
      intro={`${BRAND} çerezleri ve benzer teknolojileri (ör. tarayıcı yerel depolaması) minimum düzeyde kullanır. Bu sayfa hangilerini, neden kullandığımızı açıklar.`}
    >
      <H2>Çerez nedir?</H2>
      <P>
        Çerezler, bir web sitesini ziyaret ettiğinizde cihazınıza kaydedilen küçük metin dosyalarıdır. Bu sayfa KVKK
        Kurumu'nun çerez rehberi ve AB e-Gizlilik kuralları gözetilerek hazırlanmıştır.
      </P>

      <H2>Kullandıklarımız</H2>
      <Table
        head={["Ad", "Tür", "Amaç", "Süre"]}
        rows={[
          ["ulagg_at (çerez)", "Kesinlikle gerekli", "Giriş yaptığınızı sunucuya iletmek (görseller, dosya indirme ve Etsy'ye bağlanma gibi isteklerde)", "Oturum belirtecinin süresi (yaklaşık 1 saat, otomatik yenilenir)"],
          ["sb-…-auth-token (yerel depolama, Supabase)", "Kesinlikle gerekli", "Google/e-posta ile girişi ve oturum yenilemeyi sağlamak", "Çıkış yapana kadar"],
          ["pendingConsent (yerel depolama)", "Kesinlikle gerekli", "Kayıt sırasında verdiğiniz onayı ilk girişte kaydetmek", "Birkaç dakika (kullanılınca silinir)"],
          ["theme (yerel depolama)", "İşlevsel", "Açık/koyu tema tercihinizi hatırlamak", "Siz silene kadar"],
          ["ulagg_cookie_notice (yerel depolama)", "İşlevsel", "Bu bilgilendirmeyi kapattığınızı hatırlamak", "12 ay"],
        ]}
      />

      <H2>Analitik ve reklam çerezleri</H2>
      <P>
        Şu anda analitik, reklam veya pazarlama amaçlı çerez kullanmıyoruz. İleride kullanmaya başlarsak bunları
        yalnızca siz aktif olarak kabul ettiğinizde (önceden işaretli kutu olmadan) etkinleştirir ve bu sayfayı
        güncelleriz.
      </P>

      <H2>Hukuki dayanak</H2>
      <P>
        Kesinlikle gerekli çerezler hizmetin sunulması için zorunludur ve açık rıza gerektirmez. İşlevsel tercihler
        yalnızca sizin yaptığınız seçimi saklar ve kişisel veri toplamaz.
      </P>

      <H2>Çerezleri yönetme</H2>
      <P>
        Tarayıcı ayarlarınızdan çerezleri silebilir veya engelleyebilirsiniz. Kesinlikle gerekli çerezleri engellerseniz
        giriş yapamazsınız.
      </P>

      <H2>İletişim</H2>
      <P>{COMPANY.email}</P>
    </LegalLayout>
  );
}
