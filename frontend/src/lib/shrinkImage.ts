/** Yüklemeden önce büyük fotoğrafları telefonda küçültür: en uzun kenar MAX_SIDE pikseli aşarsa o boyuta indirilir
 * (Etsy ~2000 px ister, 3000 px bol bol yeter); daha küçük dosyalara dokunulmaz. Dönüş JPEG'dir, EXIF yönü uygulanmıştır
 * (dik çekilen fotoğraf yan dönmez). Çözülemeyen biçimlerde (ör. Chrome'da HEIC) ya da herhangi bir hatada dosya olduğu
 * gibi döner; sunucu zaten 15 MB'a kadar orijinali kabul eder. */
export const MAX_SIDE = 3000;
const QUALITY = 0.9;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.fillStyle = "#fff"; // şeffaf PNG'ler JPEG'de siyah olmasın
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file; // kazanç yoksa orijinal
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
