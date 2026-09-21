"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, API_URL, Shop, User } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/", label: "Listing'ler" },
  { href: "/orders", label: "Siparişler" },
  { href: "/finance", label: "Finans" },
  { href: "/shipping", label: "Kargo ayarları" },
  { href: "/settings", label: "Ayarlar" },
];

export default function Sidebar({
  user,
  shops,
  activeShop,
  onSwitchShop,
  current,
}: {
  user: User;
  shops?: Shop[] | null;
  activeShop: Shop | null;
  onSwitchShop?: (id: number) => void;
  current: string;
}) {
  const router = useRouter();
  const connectedShops = (shops ?? []).filter((s) => s.connected);

  async function handleLogout() {
    await api.auth.logout();
    router.push("/login");
  }

  return (
    <aside className="w-56 flex-shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Etsy Otomasyon</h1>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block text-sm font-medium px-3 py-2 rounded-lg transition ${
              current === item.href
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
        {connectedShops.length > 1 ? (
          <div>
            <label className="block text-[10px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide mb-1">
              Aktif Mağaza
            </label>
            <select
              value={activeShop?.id ?? ""}
              onChange={(e) => onSwitchShop?.(Number(e.target.value))}
              className="w-full text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg px-2 py-1.5 outline-none"
            >
              {connectedShops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.shop_name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          activeShop && (
            <span className="inline-block text-xs font-medium text-green-600 dark:text-green-400 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-950">
              {activeShop.shop_name} bağlı
            </span>
          )
        )}

        <div className="flex items-center gap-2 px-1 min-w-0">
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${API_URL}${user.avatar_url}`}
              alt=""
              className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-neutral-100 dark:border-neutral-800"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-neutral-200 dark:bg-neutral-700 flex-shrink-0" />
          )}
          <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {user.name || user.email}
          </span>
        </div>

        <button
          onClick={handleLogout}
          className="w-full text-sm font-medium px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        >
          Çıkış yap
        </button>
      </div>
    </aside>
  );
}
