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

        <H2>6. Digital service and right of withdrawal</H2>
        <P>
          Credits are a digital service that is delivered to your balance immediately after payment, and each AI action is
          performed as soon as you start it. Before you pay, we ask you to confirm that you want the service to start
          immediately and that you understand that credits you have spent can no longer be withdrawn or refunded. This does
          not affect the {REFUND_DAYS}-day refund for unused credits in section 2, which we offer on top of any legal right.
        </P>

        <H2>7. Free and bonus credits</H2>
        <P>
          Sign-up gifts and promotional credits have no cash value and are not refundable. Larger packs and custom amounts
          are priced lower per credit; a refund returns what you paid for that purchase, and the credits that purchase added
          are removed from your balance.
        </P>

        <H2>8. Prices, taxes and invoices</H2>
        <UL>
          <li>Prices are shown in the currency on the pricing page and at checkout. Taxes such as VAT are calculated at checkout from your country and shown before you pay.</li>
          <li>You receive an invoice or receipt for every purchase by email. Refunds are made in the currency of the original payment.</li>
        </UL>

        <H2>9. Disputes and chargebacks</H2>
        <P>
          Please contact us before you open a dispute with your bank. We resolve almost every problem within days, and a
          dispute can freeze the account while it is reviewed. If a payment is reversed, the credits from that payment are
          removed from your balance.
        </P>

        <H2>10. Account closure</H2>
        <UL>
          <li>If you delete your account, the credits left in it are deleted with it and are not refunded. Ask for a refund of unused credits first if you want one.</li>
          <li>If we close an account for breaking the Terms of Service, remaining credits can be forfeited. If we shut the service down, we refund the unused paid credits.</li>
        </UL>

        <H2>11. Your legal rights</H2>
        <P>These rules do not limit any mandatory consumer rights you have under the law where you live.</P>

        <H2>12. Contact</H2>
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

      <H2>6. Dijital hizmet ve cayma hakkı</H2>
      <P>
        Krediler, ödemeden hemen sonra bakiyenize yüklenen dijital bir hizmettir ve her yapay zekâ işlemi siz başlatır
        başlatmaz yerine getirilir. Ödeme öncesinde, hizmetin hemen başlamasını istediğinizi ve harcadığınız kredilerde
        cayma veya iade hakkınızın kalmayacağını anladığınızı onaylamanızı isteriz (Mesafeli Sözleşmeler Yönetmeliği m.15
        uyarınca, elektronik ortamda anında ifa edilen hizmetlerde cayma hakkı kullanılamaz). Bu durum, 2. maddedeki
        kullanılmamış kredilere tanıdığımız {REFUND_DAYS} günlük iadeyi etkilemez; o iade yasal haklarınıza ek olarak
        sunulur.
      </P>

      <H2>7. Hediye ve bonus krediler</H2>
      <P>
        Kayıt hediyesi ve kampanya kredilerinin nakit değeri yoktur ve iade edilmez. Büyük paketlerde ve özel miktarlarda kredi
        başına fiyat daha düşüktür; iade, o satın alma için ödediğiniz tutarı geri verir ve o satın almayla yüklenen krediler
        bakiyenizden düşülür.
      </P>

      <H2>8. Fiyat, vergi ve fatura</H2>
      <UL>
        <li>Fiyatlar fiyatlandırma sayfasında ve ödeme sırasında gösterilen para biriminde verilir. KDV gibi vergiler ödeme sırasında ülkenize göre hesaplanır ve ödemeden önce gösterilir.</li>
        <li>Her satın alma için e-postayla fatura veya makbuz alırsınız. İadeler, ilk ödemenin yapıldığı para biriminde yapılır.</li>
      </UL>

      <H2>9. İtirazlar ve geri ödeme talepleri (chargeback)</H2>
      <P>
        Bankanızda itiraz açmadan önce lütfen bize yazın; sorunların neredeyse tamamını birkaç gün içinde çözeriz. Banka
        itirazı inceleme süresince hesabın kilitlenmesine yol açabilir. Bir ödeme geri çevrilirse, o ödemeyle yüklenen
        krediler bakiyenizden düşülür.
      </P>

      <H2>10. Hesap kapatma</H2>
      <UL>
        <li>Hesabınızı silerseniz, içindeki kalan krediler de silinir ve iade edilmez. Kullanılmamış kredilerin iadesini istiyorsanız silmeden önce başvurun.</li>
        <li>Kullanım Koşulları&apos;nı ihlal ettiği için kapattığımız hesaplarda kalan krediler yanabilir. Hizmeti tamamen kapatırsak kullanılmamış ücretli krediler iade edilir.</li>
      </UL>

      <H2>11. Yasal haklarınız</H2>
      <P>Bu kurallar, bulunduğunuz ülkenin hukukundan doğan zorunlu tüketici haklarınızı sınırlamaz.</P>

      <H2>12. İletişim</H2>
      <P>{COMPANY.name} · {COMPANY.email}</P>
    </LegalLayout>
  );
}
