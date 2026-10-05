import type { Metadata } from "next";
import { getLang } from "@/lib/i18n-server";
import LegalLayout, { H2, P, UL, Table } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: `KVKK Aydınlatma Metni — ${BRAND}` };

export default async function KvkkPage() {
  const lang = await getLang();
  return (
    <LegalLayout
      lang={lang}
      title="KVKK Aydınlatma Metni"
      intro={`6698 sayılı Kişisel Verilerin Korunması Kanunu'nun ("KVKK") 10. maddesi uyarınca, ${BRAND} hizmetini kullanırken kişisel verilerinizin nasıl işlendiğini bu metinle bildiriyoruz.`}
    >
      {lang === "en" && (
        <P>
          This notice is the data-protection information required by Turkey's Personal Data Protection Law (KVKK) and is
          provided in Turkish. Everyone else should read the <a className="underline" href="/privacy">Privacy Policy</a>.
        </P>
      )}
      <H2>1. Veri sorumlusu</H2>
      <UL>
        <li>Unvan: {COMPANY.name}</li>
        <li>Adres: {COMPANY.address}</li>
        <li>MERSİS No: {COMPANY.mersis}</li>
        <li>Vergi Dairesi / No: {COMPANY.tax}</li>
        <li>Ticaret Sicil No: {COMPANY.tradeRegistry}</li>
        <li>İletişim: {COMPANY.kvkkEmail}</li>
      </UL>

      <H2>2. İşlenen kişisel veriler, amaçlar ve hukuki sebepler</H2>
      <Table
        head={["Veri kategorisi", "İşleme amacı", "Hukuki sebep (KVKK m.5)"]}
        rows={[
          ["Kimlik ve iletişim: e-posta, ad (Google ile girişte Google'dan gelen ad ve e-posta)", "Hesap oluşturma, giriş, destek, hizmet bildirimleri", "Sözleşmenin kurulması ve ifası (m.5/2-c)"],
          ["Etsy bağlantı verileri: mağaza bilgileri, erişim ve yenileme belirteçleri (şifreli saklanır)", "Etsy mağazanızı sizin yetkilendirmenizle yönetmek", "Sözleşmenin ifası; açık rızanız (Etsy izin ekranı)"],
          ["Mağaza içeriği: ürün listeleri, görseller, fiyatlar, yorumlar, performans verisi", "Listeleme düzenleme, SEO ve performans analizi", "Sözleşmenin ifası"],
          ["Sipariş verileri: alıcı adı, teslimat adresi, sipariş ve kargo bilgisi, kişiselleştirme notları", "Sipariş yönetimi, kargo ve kârlılık hesabı", "Sözleşmenin ifası; satıcının meşru menfaati (m.5/2-f)"],
          ["Finansal veriler: maliyetler, ücretler, kargo faturaları", "Kâr/zarar raporları", "Sözleşmenin ifası"],
          ["İşlem güvenliği: IP adresi, oturum ve cihaz bilgisi, işlem kayıtları", "Güvenlik, kötüye kullanımın önlenmesi, hata ayıklama", "Hukuki yükümlülük (m.5/2-ç); meşru menfaat (m.5/2-f)"],
          ["Kullanım ve onay kayıtları: kabul edilen metin sürümü, zaman damgası", "Yasal yükümlülüklerin ispatı", "Hukuki yükümlülük; meşru menfaat"],
        ]}
      />
      <P>
        Sipariş verilerindeki alıcı bilgileri bakımından siz (satıcı) kendi müşterilerinizin verisi için veri sorumlusu,
        biz ise sizin adınıza işlem yapan veri işleyen konumundayız. Bu veriler yalnızca size hizmet sunmak için işlenir
        ve başka amaçla kullanılmaz.
      </P>

      <H2>3. Verilerin toplanma yöntemi</H2>
      <P>
        Verileriniz; kayıt ve giriş formları, Etsy API'si (siz yetki verdikten sonra), uygulama içinde girdiğiniz bilgiler
        ve hizmetin kullanımı sırasında otomatik olarak oluşan kayıtlar yoluyla elektronik ortamda toplanır.
      </P>

      <H2>4. Verilerin aktarıldığı taraflar</H2>
      <P>Verileriniz, hizmetin sunulması için gerekli olduğu ölçüde aşağıdaki hizmet sağlayıcılara aktarılır:</P>
      <Table
        head={["Alıcı", "Amaç", "Konum"]}
        rows={[
          ["Etsy, Inc.", "Mağaza verisinin okunması ve yayınlanan değişikliklerin yazılması", "ABD"],
          ["Supabase", "Kimlik doğrulama, veritabanı, dosya depolama", "AB (Frankfurt/Avrupa bölgesi)"],
          ["Render", "Uygulama sunucusu ve arka plan işleri", "AB/ABD"],
          ["Vercel", "Web arayüzünün barındırılması", "Küresel (CDN)"],
          ["Anthropic, OpenAI, Google", "Yapay zekâ ile metin ve görsel üretimi (yalnızca siz bir AI özelliğini kullandığınızda)", "ABD"],
          ["Ödeme sağlayıcı (ücretli planlar başladığında)", "Abonelik ve fatura işlemleri", "AB/ABD"],
        ]}
      />
      <P>
        Yasal zorunluluk halinde yetkili kamu kurum ve kuruluşlarıyla da paylaşım yapılabilir. Verileriniz üçüncü kişilere
        satılmaz, reklam amacıyla paylaşılmaz.
      </P>

      <H2>5. Yurt dışına aktarım</H2>
      <P>
        Yukarıdaki hizmet sağlayıcıların bir kısmı Türkiye dışında bulunmaktadır. Aktarımlar KVKK'nın 9. maddesinde
        öngörülen güvencelerden biriyle, özellikle Kurum tarafından yayımlanan standart sözleşmelerle ve gerektiğinde
        açık rızanızla yapılır. Yapay zekâ özelliklerini kullanmak istemiyorsanız ayarlardan kapatabilirsiniz; bu durumda
        içeriğiniz AI sağlayıcılarına gönderilmez.
      </P>

      <H2>6. Saklama süresi</H2>
      <UL>
        <li>Hesap ve mağaza verileri: hesabınız açık olduğu sürece.</li>
        <li>Etsy'den alınan veriler: Etsy API şartlarındaki yenileme ve saklama sınırlarına uygun olarak güncel tutulur; Etsy bağlantısını kestiğinizde ilgili veriler silinir.</li>
        <li>Hesap silme talebinden sonra kişisel veriler makul bir süre içinde silinir veya anonim hale getirilir; yasal saklama yükümlülüğü olan kayıtlar (ör. fatura) ilgili süre boyunca tutulur.</li>
        <li>İletişim formu mesajları ve ekleri: 12 ay sonra otomatik silinir.</li>
        <li>Asistan sohbetleri: Etsy bağlantısı kesildiğinde silinir; sohbete eklenen dosyalar 90 gün, 12 ay boyunca açılmayan sohbetler 12 ay sonra otomatik silinir.</li>
        <li>Asistanın mağaza notları (&quot;hatırladıkları&quot;): siz silene kadar ya da hesap silinene kadar; Ayarlar &gt; Yapay Zekâ&apos;dan yönetilir.</li>
        <li>Banner oluşturucuda üretilen görseller: 30 gün sonra otomatik silinir.</li>
        <li>Asistan kullanım miktarı (token sayısı, içerik içermez): maliyet takibi için hesabınız açık olduğu sürece.</li>
        <li>Kayıt onayı kayıtları (metin sürümü, zaman, IP adresi): yasal ispat için hesabınız açık olduğu sürece; hesap silindiğinde silinir.</li>
        <li>Sunucu ve altyapı günlükleri: barındırma sağlayıcılarının kendi, kısa saklama süreleriyle sınırlıdır.</li>
      </UL>

      <H2>7. KVKK m.11 kapsamındaki haklarınız</H2>
      <UL>
        <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
        <li>İşlenmişse buna ilişkin bilgi talep etme,</li>
        <li>İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme,</li>
        <li>Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
        <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
        <li>KVKK'da öngörülen şartlar çerçevesinde silinmesini veya yok edilmesini isteme ve bunun aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>
        <li>İşlenen verilerin münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuç çıkmasına itiraz etme,</li>
        <li>Kanuna aykırı işlenmesi nedeniyle zarara uğramanız halinde zararın giderilmesini talep etme.</li>
      </UL>

      <H2>8. Başvuru yöntemi</H2>
      <P>
        Haklarınızı kullanmak için talebinizi {COMPANY.kvkkEmail} adresine, hesabınızla ilişkili e-posta adresinden
        göndererek veya yukarıdaki adrese yazılı olarak iletebilirsiniz. Başvurular en geç 30 gün içinde ücretsiz
        sonuçlandırılır. Cevabı yetersiz bulursanız Kişisel Verileri Koruma Kurulu'na şikâyet hakkınız saklıdır.
      </P>
      <P>
        Hesabınızı ve verilerinizi uygulama içinde Ayarlar &gt; Tehlikeli bölge sayfasından da doğrudan silebilirsiniz.
      </P>

      <H2>9. Açık rıza gerektiren işlemler</H2>
      <P>
        Hizmetin sunulması için zorunlu olmayan işlemler (ör. isteğe bağlı çerezler, pazarlama e-postaları) için ayrıca ve
        ayrı bir onayla açık rızanız istenir. Bu rıza hizmetin kullanımına şart koşulmaz ve istediğiniz zaman geri
        çekilebilir.
      </P>
    </LegalLayout>
  );
}
