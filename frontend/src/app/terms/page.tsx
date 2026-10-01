import type { Metadata } from "next";
import Link from "next/link";
import LegalLayout, { H2, P, UL } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY, ETSY_DISCLAIMER } from "@/lib/legal";

export const metadata: Metadata = { title: `Kullanım Koşulları — ${BRAND}` };

export default function TermsPage() {
  return (
    <LegalLayout
      title="Kullanım Koşulları"
      intro={`Bu koşullar, ${COMPANY.name} tarafından sunulan ${BRAND} hizmetini kullanımınızı düzenler. Hesap oluşturarak veya hizmeti kullanarak bu koşulları kabul etmiş olursunuz.`}
    >
      <H2>1. Hizmet</H2>
      <P>
        {BRAND}, Etsy satıcılarının listelerini, siparişlerini, kârlılığını ve ürün içeriğini yönetmesine yardımcı olan bir
        yazılım hizmetidir. {BRAND}, Etsy, Inc. ile bağlantılı değildir ve Etsy tarafından onaylanmamıştır.
      </P>
      <P>{ETSY_DISCLAIMER}</P>

      <H2>2. Hesap</H2>
      <UL>
        <li>18 yaşından büyük olmalı ve doğru bilgi vermelisiniz.</li>
        <li>Hesabınızın güvenliğinden siz sorumlusunuz; yetkisiz kullanımdan haberdar olursanız bize bildirin.</li>
        <li>Bir Etsy mağazasını yalnızca o mağazayı yönetme yetkiniz varsa bağlayabilirsiniz.</li>
      </UL>

      <H2>3. Etsy bağlantısı</H2>
      <P>
        Etsy mağazanızı Etsy'nin izin ekranı üzerinden bağlarsınız ve bağlantıyı istediğiniz zaman kesebilirsiniz. Etsy
        hesabınızın Etsy'nin kendi koşullarına ve API şartlarına uygun kullanımından siz sorumlusunuz. Etsy'nin API
        erişimini kısıtlaması veya değiştirmesi halinde hizmetin bazı özellikleri etkilenebilir.
      </P>

      <H2>4. Yayın ve onay</H2>
      <P>
        Mağazanıza yazılan her değişiklik sizin onayınızla yapılır. AI tarafından üretilen içerikleri yayınlamadan önce
        kontrol etmek sizin sorumluluğunuzdadır. {BRAND} sonuçların doğruluğunu, satış artışını veya Etsy'deki sıralamayı
        garanti etmez.
      </P>

      <H2>5. Kabul edilebilir kullanım</H2>
      <UL>
        <li>Hizmeti hukuka, Etsy politikalarına ve üçüncü kişilerin haklarına aykırı biçimde kullanmamak.</li>
        <li>Telif, marka veya kişilik hakkı ihlali içeren içerik yüklememek veya üretmemek; üzerinde hakkınız olmayan görselleri kullanmamak.</li>
        <li>Hizmeti tersine mühendislikle çözmeye, otomatik kazıma yapmaya veya aşırı yük bindirmeye çalışmamak.</li>
        <li>Hesabı başkalarıyla izinsiz paylaşmamak veya yeniden satmamak.</li>
      </UL>

      <H2>6. Yapay zekâ içerikleri</H2>
      <P>
        AI ile üretilen metin ve görsellerden doğan sorumluluk, içeriği yayınlayan siz sahibine aittir. Ürün veya marka
        ihlali oluşturabilecek içerik üretmeyin. Ayrıntılar için{" "}
        <Link className="underline" href="/ai-data">Yapay Zekâ ve Veri İşleme</Link> sayfasına bakın.
      </P>

      <H2>7. Ücretler</H2>
      <P>
        Ücretsiz ve ücretli planlar sunulabilir. Ücretli planların fiyatı, kullanım limitleri ve AI kredileri satın alma
        sırasında gösterilir. Abonelikler iptal edilmediği sürece yenilenir. İade koşulları satın alma sayfasında
        belirtilecektir.
      </P>

      <H2>8. Veriler</H2>
      <P>
        Verileriniz size aittir. Bize, hizmeti sunmak için gerekli olan sınırlı bir kullanım izni verirsiniz. Verilerin
        işlenmesi{" "}
        <Link className="underline" href="/privacy">Gizlilik Politikası</Link> ve{" "}
        <Link className="underline" href="/kvkk">KVKK Aydınlatma Metni</Link>'ne tabidir. Hesabınızı istediğiniz zaman
        silebilirsiniz.
      </P>

      <H2>9. Hizmet seviyesi</H2>
      <P>
        Hizmeti kesintisiz ve hatasız sunmayı hedefleriz fakat garanti etmeyiz. Bakım, üçüncü taraf kesintileri ve Etsy
        API sınırları nedeniyle erişim sınırlı olabilir.
      </P>

      <H2>10. Sorumluluğun sınırlandırılması</H2>
      <P>
        Hizmet &quot;olduğu gibi&quot; sunulur. Yasaların izin verdiği ölçüde, dolaylı zararlardan, kâr kaybından, veri
        kaybından veya Etsy hesabınıza gelen kısıtlamalardan sorumlu değiliz. Toplam sorumluluğumuz, olayın öncesindeki 12
        ay içinde bize ödediğiniz tutarla sınırlıdır. Tüketici mevzuatından doğan, sınırlandırılamayacak haklarınız saklıdır.
      </P>

      <H2>11. Askıya alma ve fesih</H2>
      <P>
        Koşulları ihlal etmeniz halinde hesabınızı askıya alabilir veya kapatabiliriz. Siz de istediğiniz zaman hesabı
        silebilirsiniz. Hizmeti tamamen sonlandırmamız halinde makul bir süre önceden bildirim yapar ve verilerinizi
        dışa aktarmanız için süre tanırız.
      </P>

      <H2>12. Değişiklikler</H2>
      <P>
        Koşulları güncelleyebiliriz. Önemli değişikliklerde önceden bildirim yapar ve gerekirse yeniden onay isteriz.
        Değişiklikten sonra hizmeti kullanmaya devam etmeniz yeni koşulları kabul ettiğiniz anlamına gelir.
      </P>

      <H2>13. Uygulanacak hukuk</H2>
      <P>
        Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır; uyuşmazlıklarda {COMPANY.name}'nin bulunduğu yerin mahkemeleri
        ve icra daireleri yetkilidir. Tüketici sıfatıyla sahip olduğunuz zorunlu yetki kuralları saklıdır.
      </P>

      <H2>14. İletişim</H2>
      <P>{COMPANY.email}</P>
    </LegalLayout>
  );
}
