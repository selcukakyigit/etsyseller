"use client";

import { useState } from "react";
import { api, Listing, Suggestion } from "@/lib/api";

function DiffField({
  label,
  original,
  suggested,
}: {
  label: string;
  original: string;
  suggested: string;
}) {
  const changed = original !== suggested;
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-medium text-neutral-400 mb-1">{label} · mevcut</p>
        <p className="text-sm text-neutral-500 whitespace-pre-wrap">{original}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-[#F1641E] mb-1">{label} · öneri</p>
        <p
          className={`text-sm whitespace-pre-wrap ${
            changed ? "text-neutral-900 font-medium" : "text-neutral-500"
          }`}
        >
          {suggested}
        </p>
      </div>
    </div>
  );
}

function TagPills({ tags, accent = false }: { tags: string[]; accent?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`px-2 py-0.5 rounded-full text-xs border ${
            accent
              ? "border-[#F1641E]/30 bg-[#F1641E]/10 text-[#c94f16]"
              : "border-neutral-200 bg-neutral-50 text-neutral-500"
          }`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export default function ListingRow({ shopId, listing }: { shopId: number; listing: Listing }) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(listing.pending_suggestion);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listings.suggest(shopId, listing.listing_id);
      setSuggestion(result);
      setExpanded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!suggestion) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.listings.apply(shopId, suggestion.id);
      setSuggestion(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss() {
    if (!suggestion) return;
    setLoading(true);
    setError(null);
    try {
      await api.listings.dismiss(shopId, suggestion.id);
      setSuggestion(null);
      setExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        {listing.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.image_url}
            alt=""
            className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-neutral-100"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-neutral-100 flex-shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <p className="font-medium text-neutral-900 truncate">{listing.title}</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            {listing.views ?? 0} görüntülenme · {listing.favorites ?? 0} favori · {listing.tags.length} etiket
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {suggestion && suggestion.status === "applied" && (
            <span className="text-xs font-medium text-green-600 px-2.5 py-1 rounded-full bg-green-50">
              Uygulandı
            </span>
          )}
          {suggestion && suggestion.status === "pending" && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium text-[#F1641E] px-2.5 py-1 rounded-full bg-[#F1641E]/10 hover:bg-[#F1641E]/20 transition"
            >
              {expanded ? "Öneriyi gizle" : "Öneriyi gör"}
            </button>
          )}
          <button
            onClick={handleSuggest}
            disabled={loading}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition disabled:opacity-50"
          >
            {loading && !suggestion ? "Üretiliyor…" : "AI Önerisi Üret"}
          </button>
        </div>
      </div>

      {error && <p className="px-4 pb-3 text-sm text-red-600">{error}</p>}

      {expanded && suggestion && (
        <div className="border-t border-neutral-100 bg-neutral-50/50 p-4 space-y-4">
          <DiffField label="Başlık" original={suggestion.original_title} suggested={suggestion.suggested_title} />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-neutral-400 mb-1.5">Etiketler · mevcut</p>
              <TagPills tags={suggestion.original_tags} />
            </div>
            <div>
              <p className="text-xs font-medium text-[#F1641E] mb-1.5">Etiketler · öneri</p>
              <TagPills tags={suggestion.suggested_tags} accent />
            </div>
          </div>

          <DiffField
            label="Açıklama"
            original={suggestion.original_description}
            suggested={suggestion.suggested_description}
          />

          {suggestion.rationale && (
            <div className="rounded-lg bg-white border border-neutral-200 p-3">
              <p className="text-xs font-medium text-neutral-400 mb-1">Gerekçe</p>
              <p className="text-sm text-neutral-600">{suggestion.rationale}</p>
            </div>
          )}

          {suggestion.status === "pending" && (
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleDismiss}
                disabled={loading}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-100 transition disabled:opacity-50"
              >
                Reddet
              </button>
              <button
                onClick={handleApply}
                disabled={loading}
                className="text-sm font-medium px-3 py-1.5 rounded-lg bg-[#F1641E] text-white hover:bg-[#d9560f] transition disabled:opacity-50"
              >
                {loading ? "Uygulanıyor…" : "Tek Tıkla Uygula"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
