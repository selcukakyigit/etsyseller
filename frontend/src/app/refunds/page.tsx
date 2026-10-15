import type { Metadata } from "next";
import { getLang } from "@/lib/i18n-server";
import LegalLayout, { H2, P, UL } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY, REFUND_DAYS } from "@/lib/legal";

export const metadata: Metadata = { title: `İade Politikası / Refund Policy — ${BRAND}` };

export default async function RefundsPage() {
  const lang = await getLang();
  if (lang === "en") {
    return (
      <LegalLayout
        lang="en"
        title="Refund Policy"
        intro={`${BRAND} is sold as prepaid credits, not as a subscription. This page explains when you can get your money back.`}
      >
        <H2>1. What you buy</H2>
        <P>
          {BRAND} is software for Etsy sellers. You buy credit packs once and spend credits as you use the AI features.
          Credits never expire. There is no subscription, so nothing renews and nothing is charged automatically.
        </P>

        <H2>2. Unused credits</H2>
        <P>
          If you have not spent any credits from a pack, you can ask for a full refund within {REFUND_DAYS} days of the
          purchase. We refund the original payment method.
        </P>

        <H2>3. Used credits</H2>
        <P>
          Credits that have been spent are not refundable, because the AI work has already been done and paid for. If you
          spent part of a pack, the remaining credits of that pack are not refunded either.
        </P>

        <H2>4. Technical problems and double charges</H2>
        <UL>
          <li>If an AI action fails and you are charged for it, the credits are returned to your balance.</li>
          <li>If you were charged twice for the same purchase, we refund the extra payment in full, with no time limit.</li>
          <li>If a technical fault on our side stops you from using credits you paid for, contact us and we will fix it or refund it.</li>
        </UL>

        <H2>5. How to ask for a refund</H2>
        <P>
          Email {COMPANY.email} from the address of your account and tell us the purchase date and amount. We reply within 3
          business days. Payments are processed by our payment partner, and approved refunds usually reach your account within
          5 to 10 business days, depending on your bank.
        </P>

        <H2>6. Your legal rights</H2>
        <P>These rules do not limit any mandatory consumer rights you have under the law where you live.</P>

        <H2>7. Contact</H2>
        <P>{COMPANY.name} · {COMPANY.email}</P>
      </LegalLayout>
    );
  }
  return (
    <LegalLayout
      lang="tr"
      title="İade Politikası"
      intro={`${BRAND} abonelikle değil, önceden satın alınan kredilerle satılır. Bu sayfa paranızı hangi durumlarda geri alabileceğinizi açıklar.`}
    >
      <H2>1. Ne satın alırsınız?</H2>
      <P>
        {BRAND}, Etsy satıcıları için bir yazılım hizmetidir. Kredi paketlerini bir kez satın alır, yapay zekâ
        özelliklerini kullandıkça kredi harcarsınız. Kredilerin süresi dolmaz. Abonelik yoktur; yani hiçbir şey otomatik
        yenilenmez ve otomatik ücret çekilmez.
      </P>

      <H2>2. Kullanılmamış krediler</H2>
      <P>
        Bir paketten hiç kredi harcamadıysanız, satın almadan sonraki {REFUND_DAYS} gün içinde tam iade isteyebilirsiniz.
        İade, ödemeyi yaptığınız yönteme yapılır.
      </P>

      <H2>3. Kullanılmış krediler</H2>
      <P>
        Harcanan krediler iade edilmez, çünkü yapay zekâ işlemi yapılmış ve maliyeti ödenmiştir. Bir paketin bir kısmını
        harcadıysanız o paketin kalan kredileri de iade edilmez.
      </P>

      <H2>4. Teknik sorunlar ve çift çekim</H2>
      <UL>
        <li>Bir yapay zekâ işlemi başarısız olur ve kredi düşerse, kredi bakiyenize geri yüklenir.</li>
        <li>Aynı satın alma için iki kez ödeme alındıysa, fazla ödeme süre sınırı olmadan tam olarak iade edilir.</li>
        <li>Bizden kaynaklı bir teknik hata, ödediğiniz kredileri kullanmanızı engelliyorsa bize yazın; düzeltir veya iade ederiz.</li>
      </UL>

      <H2>5. İade nasıl istenir?</H2>
      <P>
        Hesabınızın e-posta adresinden {COMPANY.email} adresine satın alma tarihini ve tutarı yazarak başvurun. 3 iş günü
        içinde yanıt veririz. Ödemeler ödeme ortağımız tarafından işlenir; onaylanan iadeler bankanıza bağlı olarak genellikle
        5 ila 10 iş günü içinde hesabınıza ulaşır.
      </P>

      <H2>6. Yasal haklarınız</H2>
      <P>Bu kurallar, bulunduğunuz ülkenin hukukundan doğan zorunlu tüketici haklarınızı sınırlamaz.</P>

      <H2>7. İletişim</H2>
      <P>{COMPANY.name} · {COMPANY.email}</P>
    </LegalLayout>
  );
}
