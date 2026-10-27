/** Yeni (negatif kimlikli) bir listing Etsy'de oluşunca yerel kayıt gerçek kimliğe taşınır; yayın işinin durumu (ilerleme, hata) artık o kimlikte durmalı. */
export function publishedId(requested: number, result: { listing_id?: number | null }): number {
  return requested < 0 && result.listing_id && result.listing_id > 0 ? result.listing_id : requested;
}
