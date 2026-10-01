import type { Metadata } from "next";
import Link from "next/link";
import { getLang } from "@/lib/i18n-server";
import { PrivacyEn, PRIVACY_INTRO } from "@/content/legal-en";
import LegalLayout, { H2, P, UL } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: `Gizlilik Politikası — ${BRAND}` };

export default async function PrivacyPage() {
  const lang = await getLang();
  if (lang === "en") {
    return (
      <LegalLayout lang="en" title="Privacy Policy" intro={PRIVACY_INTRO}>
        <PrivacyEn />
      </LegalLayout>
    );
  }
  return (
    <LegalLayout
      lang="tr"
      title="Gizlilik Politikası"
      intro={`${BRAND}, Etsy satıcıları için bir operasyon ve büyüme platformudur. Bu politika hangi verileri topladığımızı, neden kullandığımızı ve haklarınızı açıklar. Türkiye (KVKK) ve Avrupa Birliği (GDPR) kullanıcıları için hazırlanmıştır.`}
    >
      <H2>1. Biz kimiz</H2>
      <P>
        Veri sorumlusu {COMPANY.name}'dir ({COMPANY.address}). İletişim: {COMPANY.email}. Türkiye'deki kullanıcılar için
        ayrıntılı bilgi <Link className="underline" href="/kvkk">KVKK Aydınlatma Metni</Link>'ndedir.
      </P>

      <H2>2. Topladığımız veriler</H2>
      <UL>
        <li><b>Hesap:</b> e-posta, ad, şifre (yalnızca özet/hash halinde), Google ile girişte Google'ın verdiği ad ve e-posta.</li>
        <li><b>Etsy verileri:</b> siz yetki verdiğinizde mağaza bilgileri, listeler, görseller, siparişler, yorumlar ve performans istatistikleri. Siparişlerde alıcı adı ve teslimat adresi bulunur.</li>
        <li><b>Sizin girdiğiniz veriler:</b> maliyetler, taslaklar, notlar, yüklediğiniz görseller.</li>
        <li><b>Teknik veriler:</b> IP adresi, tarayıcı, oturum, hata kayıtları.</li>
      </UL>
      <P>Etsy'de toplamadığımız şey: Etsy şifreniz. Bağlantı, Etsy'nin kendi izin ekranı (OAuth) üzerinden kurulur.</P>

      <H2>3. Verileri nasıl kullanırız</H2>
      <UL>
        <li>Hizmeti sunmak: listeleri düzenlemek, siparişleri ve kârlılığı göstermek, Etsy'ye yalnızca sizin onayınızla değişiklik yayınlamak.</li>
        <li>Güvenlik, hata ayıklama ve kötüye kullanımın önlenmesi.</li>
        <li>Hizmetle ilgili bildirimler ve destek.</li>
      </UL>
      <P>
        Etsy'den aldığımız verileri yapay zekâ modellerini eğitmek, üçüncü kişilere satmak, reklam profili çıkarmak veya
        sizin dışınızda başka bir satıcıya göstermek için kullanmayız.
      </P>

      <H2>4. Yapay zekâ</H2>
      <P>
        AI özelliklerini kullandığınızda ilgili içerik (ör. ürün başlığı, açıklama, görsel) üretim için sağlayıcılara
        gönderilir. Ayrıntılar için <Link className="underline" href="/ai-data">Yapay Zekâ ve Veri İşleme</Link> sayfasına bakın.
        AI çıktıları siz onaylamadan Etsy'ye yazılmaz.
      </P>

      <H2>5. Paylaşım</H2>
      <P>
        Verilerinizi yalnızca hizmeti çalıştırmak için gereken altyapı sağlayıcılarıyla (barındırma, veritabanı, kimlik
        doğrulama, AI, ödeme) ve yasal zorunluluk halinde yetkili makamlarla paylaşırız. Listenin tamamı KVKK Aydınlatma
        Metni'ndedir.
      </P>

      <H2>6. Uluslararası aktarım</H2>
      <P>
        Sağlayıcılarımızın bir kısmı AB/EEA ve Türkiye dışındadır (ör. ABD). Bu aktarımlar standart sözleşme maddeleri
        veya yeterlilik kararı gibi yasal güvencelerle yapılır.
      </P>

      <H2>7. Saklama ve silme</H2>
      <P>
        Verileri hizmeti sunmak için gerektiği süre saklarız. Etsy bağlantısını kestiğinizde Etsy'den alınan veriler
        silinir. Hesabınızı Ayarlar &gt; Tehlikeli bölge'den silebilirsiniz; bunu yaptığınızda kişisel verileriniz
        silinir veya anonimleştirilir (yasal saklama zorunluluğu olan kayıtlar hariç).
      </P>

      <H2>8. Haklarınız</H2>
      <P>
        Verilerinize erişme, düzeltme, silme, işlemeyi kısıtlama, taşıma ve itiraz etme haklarına sahipsiniz. AB'de
        yaşıyorsanız ayrıca yerel veri koruma otoritesine şikâyet hakkınız vardır. Talepler için: {COMPANY.kvkkEmail}.
      </P>

      <H2>9. Güvenlik</H2>
      <P>
        Etsy erişim belirteçleri şifrelenerek saklanır, bağlantılar HTTPS ile korunur, her müşterinin verisi diğerlerinden
        mantıksal olarak ayrılır. Hiçbir sistem tamamen risksizdir; bir veri ihlali olması halinde yasal süreler içinde
        ilgili kişileri ve gerektiğinde Etsy'yi bilgilendiririz.
      </P>

      <H2>10. Çocuklar</H2>
      <P>Hizmet 18 yaş altındakilere yönelik değildir.</P>

      <H2>11. Değişiklikler</H2>
      <P>
        Bu politikayı güncelleyebiliriz. Önemli değişiklikleri e-posta veya uygulama içinden bildirir, gerekiyorsa yeniden
        onayınızı isteriz.
      </P>
    </LegalLayout>
  );
}
