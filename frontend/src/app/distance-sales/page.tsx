import type { Metadata } from "next";
import Link from "next/link";
import { getLang } from "@/lib/i18n-server";
import LegalLayout, { H2, P, UL, Table } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY, REFUND_DAYS } from "@/lib/legal";

export const metadata: Metadata = { title: `Mesafeli Satış Sözleşmesi / Distance Sales Contract — ${BRAND}` };

export default async function DistanceSalesPage() {
  const lang = await getLang();
  if (lang === "en") {
    return (
      <LegalLayout
        lang="en"
        title="Distance Sales Contract and Pre-Contract Information"
        intro={`Information we give you before you buy credits, as required by Turkish consumer law (Law No. 6502 and the Distance Contracts Regulation). Anyone buying outside Türkiye is covered by the same terms, without prejudice to the mandatory consumer rights of their country.`}
      >
        <H2>1. Seller</H2>
        <UL>
          <li>{COMPANY.name}</li>
          <li>{COMPANY.address}</li>
          <li>{COMPANY.tax} · MERSİS {COMPANY.mersis} · Trade registry no. {COMPANY.tradeRegistry}</li>
          <li>{COMPANY.email} · WhatsApp {COMPANY.whatsappDisplay}</li>
        </UL>

        <H2>2. What you buy</H2>
        <P>
          A credit pack for {BRAND}, a software service for Etsy sellers. Credits are added to your account balance and are
          spent on AI actions (text, images, video). Credits never expire, cannot be transferred or exchanged for cash, and
          there is no subscription. The credits and price of every pack are shown on the{" "}
          <Link className="underline" href="/pricing">pricing page</Link> and at checkout.
        </P>

        <H2>3. Price, taxes and payment</H2>
        <P>
          The total price, including taxes such as VAT where they apply, is shown at checkout before you pay. Payment is made
          once, by card or another method offered at checkout, through our payment partner. There is no delivery cost.
        </P>

        <H2>4. Performance</H2>
        <P>Credits are added to your balance immediately after the payment is confirmed. The service is digital; nothing is shipped.</P>

        <H2>5. Right of withdrawal</H2>
        <UL>
          <li>You may withdraw from the contract within 14 days without giving a reason, as long as the service has not started on your request.</li>
          <li>Credits are performed immediately. Before paying you confirm that you want performance to start immediately. Credits you have already spent can no longer be withdrawn, because the service was performed with your approval.</li>
          <li>On top of this, we refund a pack in full if you have spent none of its credits within {REFUND_DAYS} days of purchase. See the <Link className="underline" href="/refunds">Refund Policy</Link>.</li>
          <li>To withdraw, email {COMPANY.email} from your account address, stating the date and amount of the purchase.</li>
        </UL>

        <H2>6. Complaints and disputes</H2>
        <P>
          Write to {COMPANY.email} first. If we cannot resolve the problem, consumers in Türkiye can apply to the consumer
          arbitration committee or the consumer court at their place of residence, within the monetary limits set by law.
          Other consumers keep the rights they have in their own country.
        </P>

        <H2>7. Acceptance</H2>
        <P>
          By ticking the box before checkout you confirm that you have read this information, the{" "}
          <Link className="underline" href="/terms">Terms of Service</Link> and the{" "}
          <Link className="underline" href="/refunds">Refund Policy</Link>, and that the contract is concluded electronically.
        </P>
      </LegalLayout>
    );
  }
  return (
    <LegalLayout
      lang="tr"
      title="Mesafeli Satış Sözleşmesi ve Ön Bilgilendirme Formu"
      intro={`6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, kredi satın almadan önce size verilmesi gereken bilgiler ve sözleşme koşulları.`}
    >
      <H2>1. Satıcı</H2>
      <Table
        head={["Bilgi", "Değer"]}
        rows={[
          ["Unvan", COMPANY.name],
          ["Adres", COMPANY.address],
          ["Vergi Dairesi / No", COMPANY.tax],
          ["MERSİS No", COMPANY.mersis],
          ["Ticaret Sicil No", COMPANY.tradeRegistry],
          ["E-posta", COMPANY.email],
          ["Telefon / WhatsApp", COMPANY.whatsappDisplay],
        ]}
      />

      <H2>2. Sözleşmenin konusu ve temel nitelikleri</H2>
      <P>
        Etsy satıcılarına yönelik yazılım hizmeti {BRAND} için kredi paketi satışı. Krediler hesap bakiyenize eklenir ve
        yapay zekâ işlemlerinde (metin, görsel, video) harcanır. Kredilerin süresi dolmaz; devredilemez ve nakde çevrilemez.
        Abonelik yoktur. Her paketin kredisi ve fiyatı <Link className="underline" href="/pricing">fiyatlandırma sayfasında</Link> ve
        ödeme ekranında gösterilir.
      </P>

      <H2>3. Fiyat, vergi ve ödeme</H2>
      <P>
        Vergiler (varsa KDV) dahil toplam fiyat, ödeme öncesinde ödeme ekranında gösterilir. Ödeme tek seferdir; ödeme ortağımız
        üzerinden kart veya ödeme ekranında sunulan başka bir yöntemle yapılır. Teslimat ücreti yoktur.
      </P>

      <H2>4. İfa</H2>
      <P>Ödeme onaylanır onaylanmaz krediler bakiyenize yüklenir. Hizmet dijitaldir; fiziksel teslimat yoktur.</P>

      <H2>5. Cayma hakkı</H2>
      <UL>
        <li>Hizmetin ifasına sizin talebinizle başlanmadıkça, hiçbir gerekçe göstermeden 14 gün içinde sözleşmeden cayabilirsiniz.</li>
        <li>Krediler elektronik ortamda anında ifa edilir. Ödemeden önce ifanın hemen başlamasını onaylarsınız; harcadığınız kredilerde, hizmet onayınızla ifa edildiği için cayma hakkı kullanılamaz (Mesafeli Sözleşmeler Yönetmeliği m.15).</li>
        <li>Buna ek olarak, bir paketten hiç kredi harcamadıysanız satın almadan sonraki {REFUND_DAYS} gün içinde tam iade yapılır. Ayrıntılar için <Link className="underline" href="/refunds">İade Politikası</Link>.</li>
        <li>Cayma bildirimi için hesabınızın e-postasından {COMPANY.email} adresine satın alma tarihi ve tutarı yazarak başvurun. Geri ödeme, bildirimin bize ulaşmasından itibaren en geç 14 gün içinde ödemenin yapıldığı yönteme yapılır.</li>
      </UL>

      <H2>6. Şikâyet ve uyuşmazlık</H2>
      <P>
        Önce {COMPANY.email} adresine yazın. Çözülemezse, yasal parasal sınırlar dahilinde yerleşim yerinizdeki tüketici hakem
        heyetine veya tüketici mahkemesine başvurabilirsiniz.
      </P>

      <H2>7. Onay</H2>
      <P>
        Ödemeden önceki kutuyu işaretleyerek bu ön bilgilendirmeyi, <Link className="underline" href="/terms">Kullanım Koşulları</Link>&apos;nı
        ve <Link className="underline" href="/refunds">İade Politikası</Link>&apos;nı okuduğunuzu, sözleşmenin elektronik ortamda
        kurulduğunu ve hizmetin hemen başlamasını istediğinizi onaylamış olursunuz.
      </P>
    </LegalLayout>
  );
}
