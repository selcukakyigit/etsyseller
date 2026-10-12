/** Yakalanan hatanın kullanıcıya gösterilecek metni; mesajı yoksa (ör. ağ hatası) verilen yedek metin. */
export function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
