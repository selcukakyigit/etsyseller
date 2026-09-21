"use client";

import { Listing, ListingHistory, Suggestion } from "@/lib/api";
import ListingRow from "@/components/ListingRow";

function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

const pendingSuggestion: Suggestion = {
  id: 1,
  listing_id: 111,
  original_title: "handmade ceramic mug",
  original_tags: ["mug", "ceramic", "handmade", "coffee cup", "gift"],
  original_description: "A handmade ceramic mug, great for coffee or tea. Made with love.",
  suggested_title: "Handmade Ceramic Mug | Unique Pottery Coffee Cup Gift",
  suggested_tags: [
    "handmade pottery mug",
    "unique ceramic cup",
    "artisan coffee mug",
    "ceramic drinkware",
    "gift for coffee lovers",
    "custom pottery mug",
    "rustic ceramic cup",
    "handcrafted tea mug",
    "ceramic gift idea",
    "personalized ceramic",
    "stoneware coffee cup",
    "boho kitchen decor",
    "vintage style mug",
  ],
  suggested_description:
    "Handmade Ceramic Mug - the perfect unique pottery coffee cup gift! Crafted with care, ideal for coffee or tea lovers. Size: 12 oz capacity, dishwasher and microwave safe.",
  rationale:
    "Başlığa 'Unique Pottery Coffee Cup Gift' eklenerek hem benzersizliği hem hediye olarak uygunluğu vurgulandı. Etiketler uzun kuyruklu ifadelerle zenginleştirildi.",
  status: "pending",
  created_at: isoDaysAgo(0),
  applied_at: null,
};

const mockListings: Listing[] = [
  {
    listing_id: 111,
    title: pendingSuggestion.original_title,
    tags: pendingSuggestion.original_tags,
    description: pendingSuggestion.original_description,
    url: null,
    image_url: null,
    views: 842,
    favorites: 37,
    pending_suggestion: pendingSuggestion,
  },
  {
    listing_id: 222,
    title: "Handwoven Wool Scarf | Cozy Winter Neckwear Gift",
    tags: ["wool scarf", "handwoven", "winter gift", "cozy scarf", "boho accessory"],
    description: "A handwoven wool scarf, soft and warm, perfect for winter.",
    url: null,
    image_url: null,
    views: 1560,
    favorites: 96,
    pending_suggestion: null,
  },
  {
    listing_id: 333,
    title: "silver moon necklace",
    tags: ["necklace", "silver", "moon", "jewelry"],
    description: "A delicate silver moon necklace.",
    url: null,
    image_url: null,
    views: 210,
    favorites: 8,
    pending_suggestion: null,
  },
];

const mockHistory: ListingHistory = {
  versions: [
    { ...pendingSuggestion, id: 3, status: "pending", created_at: isoDaysAgo(0) },
    {
      ...pendingSuggestion,
      id: 2,
      status: "applied",
      created_at: isoDaysAgo(9),
      applied_at: isoDaysAgo(9),
      suggested_title: "Handmade Ceramic Mug | Rustic Pottery Coffee Cup",
    },
    {
      ...pendingSuggestion,
      id: 1,
      status: "dismissed",
      created_at: isoDaysAgo(13),
      applied_at: null,
      suggested_title: "Ceramic Mug - Handmade Ready To Ship",
    },
  ],
  stats: Array.from({ length: 14 }).map((_, i) => {
    const daysAgo = 13 - i;
    const boosted = daysAgo <= 9; // after the "applied" event on day 9
    return {
      captured_at: isoDaysAgo(daysAgo),
      views: (boosted ? 55 : 30) * (14 - daysAgo) + 120,
      favorites: Math.round((boosted ? 3.2 : 1.8) * (14 - daysAgo) + 4),
    };
  }),
};

export default function PreviewPage() {
  return (
    <main className="flex-1 bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-lg font-semibold text-neutral-900">Önizleme (sahte veri)</h1>
          <p className="text-sm text-neutral-400">
            Bu sayfa gerçek Etsy/backend verisi çekmez — bileşenlerin görünümünü test etmek için.
            İlk satırda &quot;Geçmiş&quot; butonu sahte grafik verisiyle açılır; diğer satırlardaki
            &quot;AI Önerisi Üret&quot; gibi butonlar gerçek API&apos;ye istek atar ve mağaza bağlı
            olmadığı için hata döner — bu beklenen bir durum.
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-3">
        <ListingRow shopId={0} listing={mockListings[0]} mockHistory={mockHistory} />
        {mockListings.slice(1).map((listing) => (
          <ListingRow key={listing.listing_id} shopId={0} listing={listing} />
        ))}
      </div>
    </main>
  );
}
