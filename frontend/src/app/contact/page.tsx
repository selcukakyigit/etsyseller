import type { Metadata } from "next";
import Link from "next/link";
import LegalLayout, { H2, P, UL } from "@/components/legal/LegalLayout";
import { getLang } from "@/lib/i18n-server";
import { BRAND, COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: `Contact | ${BRAND}` };

export default async function ContactPage() {
  const lang = await getLang();
  if (lang === "tr") {
    return (
      <LegalLayout lang="tr" title="İletişim ve destek" intro={`${BRAND} ile ilgili sorular, sorunlar ve talepler için bize yazabilirsin.`}>
        <H2>Destek</H2>
        <P>
          Kullanım, hesap ve Etsy bağlantısı soruları için: <a className="underline" href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
          Mesajına en kısa sürede dönmeye çalışırız. Hesabınla ilişkili e-posta adresinden yazarsan işimiz kolaylaşır.
        </P>
        <H2>Gizlilik ve veri talepleri</H2>
        <P>
          Kişisel verilerinle ilgili haklarını (erişim, düzeltme, silme) kullanmak için:{" "}
          <a className="underline" href={`mailto:${COMPANY.kvkkEmail}`}>{COMPANY.kvkkEmail}</a>. Hesabını ve verilerini Ayarlar,
          Hesap ve Veriler ekranından doğrudan da silebilirsin.
        </P>
        <H2>Güvenlik açığı bildirimi</H2>
        <P>
          Bir güvenlik açığı bulduysan lütfen <a className="underline" href={`mailto:${COMPANY.kvkkEmail}`}>{COMPANY.kvkkEmail}</a> adresine
          yaz; sorunu çözene kadar herkese açık paylaşma.
        </P>
        <H2>İşletme bilgileri</H2>
        <UL>
          <li>{COMPANY.name}</li>
          <li>{COMPANY.address}</li>
        </UL>
        <P>
          <Link className="underline" href="/privacy">Gizlilik Politikası</Link> · <Link className="underline" href="/terms">Kullanım Koşulları</Link>
        </P>
      </LegalLayout>
    );
  }
  return (
    <LegalLayout lang="en" title="Contact and support" intro={`Questions, problems or requests about ${BRAND}? Write to us.`}>
      <H2>Support</H2>
      <P>
        For questions about using the product, your account or your Etsy connection:{" "}
        <a className="underline" href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>. We reply as soon as we can. Writing from the
        email address on your account helps us help you faster.
      </P>
      <H2>Privacy and data requests</H2>
      <P>
        To exercise your rights over your personal data (access, correction, deletion):{" "}
        <a className="underline" href={`mailto:${COMPANY.kvkkEmail}`}>{COMPANY.kvkkEmail}</a>. You can also delete your account and
        data yourself under Settings, Account and data.
      </P>
      <H2>Reporting a security issue</H2>
      <P>
        If you found a vulnerability, please email <a className="underline" href={`mailto:${COMPANY.kvkkEmail}`}>{COMPANY.kvkkEmail}</a> and
        give us time to fix it before sharing it publicly.
      </P>
      <H2>Business details</H2>
      <UL>
        <li>{COMPANY.name}</li>
        <li>{COMPANY.address}</li>
      </UL>
      <P>
        <Link className="underline" href="/privacy">Privacy Policy</Link> · <Link className="underline" href="/terms">Terms of Service</Link>
      </P>
    </LegalLayout>
  );
}
