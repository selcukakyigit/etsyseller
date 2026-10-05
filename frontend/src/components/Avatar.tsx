import { API_URL, User } from "@/lib/api";

// Fotoğrafı olmayan kullanıcıya, kimliğine göre hep aynı çıkan sevimli bir ikon verilir.
const ICONS = ["🦊", "🐼", "🐨", "🐯", "🦁", "🐸", "🐙", "🦄", "🐝", "🦋", "🐳", "🦉", "🐰", "🐧", "🦔", "🐢"];
const COLORS = ["#FDE2D4", "#E2ECE9", "#DDE7F7", "#FBE7F0", "#FFF1C9", "#E6E0F8", "#D8F0E4", "#FFE0D1"];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarSrc(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  return avatarUrl.startsWith("http") ? avatarUrl : `${API_URL}${avatarUrl}`;
}

export default function Avatar({
  user,
  size = 28,
  className = "",
}: {
  user: Pick<User, "id" | "email" | "avatar_url"> | null;
  size?: number;
  className?: string;
}) {
  const src = avatarSrc(user?.avatar_url);
  const style = { width: size, height: size };
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        style={style}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }
  // Kullanıcı henüz yüklenmediyse rastgele bir hayvan ikonu (başka birinin profili gibi görünür) yerine boş yer tutucu.
  if (!user) {
    return <div aria-hidden style={style} className={`rounded-full flex-shrink-0 animate-pulse bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
  }
  const seed = hash(user.email ?? String(user.id));
  return (
    <div
      aria-hidden
      style={{ ...style, backgroundColor: COLORS[(seed >> 4) % COLORS.length], fontSize: size * 0.55 }}
      className={`rounded-full flex items-center justify-center flex-shrink-0 leading-none ${className}`}
    >
      {ICONS[seed % ICONS.length]}
    </div>
  );
}
