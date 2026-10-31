import type { Metadata } from "next";
import { getLang } from "@/lib/i18n-server";
import { AiDataEn, AI_INTRO } from "@/content/legal-en";
import LegalLayout, { H2, P, UL, Table } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: `Yapay Zekâ ve Veri İşleme — ${BRAND}` };

export default async function AiDataPage() {
  const lang = await getLang();
  if (lang === "en") {
    return (
      <LegalLayout lang="en" title="AI & Data Use" intro={AI_INTRO}>
        <AiDataEn />
      </LegalLayout>
    );
  }
  return (
    <LegalLayout
      lang="tr"
      title="Yapay Zekâ ve Veri İşleme"
      intro={`${BRAND} metin ve görsel üretimi için yapay zekâ sağlayıcılarını kullanır. Bu sayfa hangi verinin nereye gittiğini ve nasıl kontrol edebileceğinizi açıklar.`}
    >
      <H2>Hangi özelliklerde AI kullanılıyor</H2>
      <UL>
        <li>Başlık, etiket ve açıklama önerileri (SEO).</li>
        <li>Ürün görseli üretimi ve düzenleme.</li>
        <li>Mağaza verinizi özetleyen sohbet asistanı.</li>
      </UL>

      <H2>Sağlayıcılar ve gönderilen veri</H2>
      <Table
        head={["Sağlayıcı", "Kullanım", "Gönderilen veri"]}
        rows={[
          ["Anthropic", "Metin üretimi, asistan", "İlgili listing metni/özelliği, asistanın cevap için gereken mağaza özeti"],
          ["OpenAI / Google", "Görsel üretimi ve düzenleme", "Seçtiğiniz ürün görseli ve yazdığınız talimat"],
          ["Replicate", "Görsel ve video üretimi için model altyapısı", "Seçtiğiniz ürün görseli ve yazdığınız talimat"],
        ]}
      />
      <P>
        Teslimat adresinin sokak, şehir, posta kodu ve telefon bilgisi AI sağlayıcılarına gönderilmez. Asistana siparişlerinizi
        sorarsanız cevap için alıcı adı, ülkesi, varsa alıcı notu ve hediye mesajı sağlayıcıya gidebilir; siparişle ilgili bir
        şey sormadığınız sürece bu veriler isteğe dahil edilmez.
      </P>

      <H2>İçerik ve kötüye kullanım</H2>
      <P>
        Marka, telif veya kişilik hakkı ihlali, yanıltıcı veya yasa dışı içerik üretmek Kullanım Koşulları&apos;nda yasaktır.
        Yapay zekâ özelliklerimiz satıcının kendi ürün görsellerinden ve talimatlarından, kendi mağazasında kullanmak üzere ürün
        fotoğrafı ve kısa ürün videosu üretir; yüz değiştirme, deepfake, ses taklidi ve bir kişinin görüntüsünün rızasız
        kullanımı yasaktır.
        Görsel ve video üretimi sağlayıcıların kendi güvenlik filtrelerinden geçer; filtre bir isteği reddederse sonuç üretilmez
        ve bunun için kredi düşülmez. Kötüye kullanım tespit edersek hesabı askıya alabilir veya kapatabiliriz. Bir içerik
        hakkında bildirimde bulunmak için support@ulagg.com adresine yazabilirsiniz.
      </P>

      <H2>Sesle yazma</H2>
      <P>
        Sohbetteki mikrofon düğmesi tarayıcınızın kendi konuşma tanımasını kullanır. Konuşmanız sunucularımıza gönderilmez ve
        kaydedilmez; metne çevrilmesi tarayıcınızın sağlayıcısı tarafından yapılır (ör. Chrome&apos;da Google). Mikrofon yalnızca
        düğmeye bastığınızda ve siz izin verdiğinizde açılır; yazıya çevrilen metni göndermeden önce düzenleyebilirsiniz.
      </P>

      <H2>Taahhütlerimiz</H2>
      <UL>
        <li>Etsy&apos;den aldığımız verileri yapay zekâ modellerini eğitmek için kullanmayız ve sağlayıcılarla eğitim için kullanılmamasını esas alan API koşullarıyla çalışırız.</li>
        <li>AI çıktıları siz kontrol edip onaylamadan Etsy mağazanıza yazılmaz.</li>
        <li>İstediğiniz zaman Ayarlar bölümünden AI özelliklerini kapatabilirsiniz; kapalıyken içeriğiniz AI sağlayıcılarına gönderilmez.</li>
      </UL>

      <H2>Sizin sorumluluğunuz</H2>
      <UL>
        <li>AI çıktıları hatalı veya eksik olabilir; yayınlamadan önce kontrol edin.</li>
        <li>Görsel üretirken veya düzenlerken, kullandığınız görselin hakkına sahip olduğunuzu onaylarsınız.</li>
        <li>Başkasının markasını, karakterini veya eserini taklit eden içerik üretmeyin; Etsy politikalarına uyun.</li>
        <li>Etsy bazı satıcılardan AI kullanımını ürün açıklamasında belirtmesini isteyebilir; bu yükümlülük size aittir.</li>
      </UL>

      <H2>Kayıtlar</H2>
      <P>
        Üretim geçmişinizi (orijinal, üretilen görsel ve kullanılan model) hesabınızda saklarız ki işlemlerinizi geri
        alabilesiniz. Bu kayıtları hesabınızı silerek kaldırabilirsiniz.
      </P>

      <H2>İletişim</H2>
      <P>{COMPANY.email}</P>
    </LegalLayout>
  );
}
