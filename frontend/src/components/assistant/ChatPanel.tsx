"use client";

import { ClipboardEvent, DragEvent, Fragment, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, API_URL, AssistantProviders, ChatMessageOut, ChatSessionInfo } from "@/lib/api";
import Card from "./Cards";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const SUGGESTIONS = [
  "Bu ayın kâr-zarar durumu nedir?",
  "Bu yıl en çok hangi ülkeye satış yaptık?",
  "Gönderilmesi gereken siparişleri göster",
  "Geçen yıla göre satışlarımız nasıl?",
  "Bu resimlerden yeni bir listing taslağı oluştur",
];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** **kalın** ve satır sonlarını destekleyen basit metin gösterimi (HTML enjekte etmez). */
function Text({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") && part.endsWith("**") ? <b key={j}>{part.slice(2, -2)}</b> : <Fragment key={j}>{part}</Fragment>))}
        </Fragment>
      ))}
    </>
  );
}

/** "Düşünüyor" göstergesi: hareketli noktalar + asistanın o an yaptığı iş (sunucudan gelir). */
function Thinking({ step }: { step: string }) {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-3 rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        <span className="flex items-end gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="inline-block h-2 w-2 animate-bounce rounded-full bg-[#F1641E]" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </span>
        <span className="transition-opacity">{step || "Düşünüyor"}…</span>
      </div>
    </div>
  );
}

type Pending = { id: string; url: string; name: string };

export default function ChatPanel({ shopId, onSent }: { shopId: number; onSent?: () => void }) {
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [providers, setProviders] = useState<AssistantProviders | null>(null);
  const [provider, setProvider] = useState("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // geçmiş paneli varsayılan olarak kapalı
  const [step, setStep] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirm, confirmElement] = useConfirm();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [todayKey] = useState(localToday); // "bugün / dün" etiketleri için
  const tempSeq = useRef(0); // geçici (henüz sunucuya yazılmamış) mesajlar için negatif kimlik

  const refreshSessions = useCallback(() => {
    api.assistant.sessions(shopId).then(setSessions).catch(() => undefined);
  }, [shopId]);

  useEffect(() => {
    api.assistant
      .providers(shopId)
      .then((p) => {
        setProviders(p);
        setProvider((cur) => cur || p.default);
      })
      .catch(() => undefined);
    refreshSessions();
  }, [shopId, refreshSessions]);

  // Bekleme sırasında asistanın ne yaptığını yokla (ör. "Benzer listing'leri inceliyor").
  useEffect(() => {
    if (!busy || !requestId) return;
    let stop = false;
    const tick = () =>
      api.assistant
        .progress(shopId, requestId)
        .then((p) => {
          if (!stop) setStep(p.step);
        })
        .catch(() => undefined);
    const id = setInterval(tick, 800);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [busy, requestId, shopId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/")).slice(0, 6 - pending.length);
    if (images.length === 0) return;
    setError(null);
    setUploading((n) => n + images.length);
    for (const f of images) {
      try {
        const up = await api.assistant.uploadImage(shopId, f);
        setPending((p) => [...p, { id: up.id, url: URL.createObjectURL(f), name: f.name }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Resim yüklenemedi");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if ((!message && pending.length === 0) || busy || uploading > 0) return;
    setBusy(true);
    setError(null);
    setStep("");
    const rid = crypto.randomUUID();
    setRequestId(rid);
    const imgs = pending;
    // Kullanıcı mesajı hemen görünsün (sunucudan cevap gelince gerçek kayıtla değişir).
    const temp: ChatMessageOut = {
      id: --tempSeq.current, role: "user", content: message, created_at: "",
      images: imgs.map((i) => ({ id: i.id, url: i.url })), cards: [],
    };
    setMessages((m) => [...m, temp]);
    setInput("");
    setPending([]);
    try {
      const reply = await api.assistant.chat(shopId, { message, session_id: sessionId, image_ids: imgs.map((i) => i.id), provider: provider || undefined, today: localToday(), request_id: rid });
      setSessionId(reply.session_id);
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), { ...reply.user, images: temp.images }, reply.assistant]);
      refreshSessions();
      onSent?.();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInput(message);
      setPending(imgs);
      setError(e instanceof Error ? e.message : "Mesaj gönderilemedi");
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function openSession(id: number) {
    setHistoryOpen(false);
    try {
      const s = await api.assistant.session(shopId, id);
      setSessionId(s.id);
      setMessages(s.messages);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sohbet açılamadı");
    }
  }

  function newChat() {
    setSessionId(null);
    setMessages([]);
    setPending([]);
    setInput("");
    setError(null);
    setHistoryOpen(false);
  }

  async function removeSession(id: number) {
    const ok = await confirm({ title: "Sohbet silinsin mi?", message: "Bu sohbet kalıcı olarak silinir.", confirmLabel: "Sil", destructive: true });
    if (!ok) return;
    await api.assistant.deleteSession(shopId, id).catch(() => undefined);
    if (id === sessionId) newChat();
    refreshSessions();
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const ok = await confirm({ title: `${selected.size} sohbet silinsin mi?`, message: "Seçili sohbetler kalıcı olarak silinir.", confirmLabel: "Sil", destructive: true });
    if (!ok) return;
    const ids = [...selected];
    await api.assistant.deleteSessions(shopId, ids).catch(() => undefined);
    if (sessionId !== null && ids.includes(sessionId)) newChat();
    setSelected(new Set());
    setSelectMode(false);
    refreshSessions();
  }

  async function deleteAll() {
    const ok = await confirm({ title: "Tüm sohbetler silinsin mi?", message: `${sessions.length} sohbetin tamamı kalıcı olarak silinir.`, confirmLabel: "Hepsini sil", destructive: true });
    if (!ok) return;
    await api.assistant.deleteSessions(shopId, null).catch(() => undefined);
    newChat();
    setSelected(new Set());
    setSelectMode(false);
    refreshSessions();
  }

  function toggleSelected(id: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function when(iso: string): string {
    const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (key === todayKey) return `bugün ${hm}`;
    const y = new Date(`${todayKey}T00:00:00`);
    y.setDate(y.getDate() - 1);
    const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    return key === yKey ? `dün ${hm}` : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }

  const img = (url: string) => (url.startsWith("blob:") || url.startsWith("http") ? url : `${API_URL}${url}`);
  const noKey = providers && !providers.providers.find((p) => p.id === provider)?.ready;

  return (
    <div
      className={`relative flex h-[calc(100vh-11rem)] min-h-[32rem] rounded-2xl border bg-white dark:bg-neutral-900 ${dragging ? "border-[#F1641E]" : "border-neutral-200 dark:border-neutral-800"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 text-sm font-semibold">Asistan</span>
          <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
            {historyOpen ? "Geçmişi gizle" : `Geçmiş (${sessions.length})`}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={newChat} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
            Yeni sohbet
          </button>
          {providers && (
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" title="Yapay zekâ sağlayıcısı">
              {providers.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.ready ? "" : " (anahtar yok)"}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-6 text-center">
            <div className="mb-1 text-lg font-semibold">Mağazanı buradan yönet</div>
            <p className="mb-4 text-sm text-neutral-500">Sor, listing oluştur, kâr-zarar durumuna bak. Resimleri sürükleyip bırakabilir ya da yapıştırabilirsin. Değişiklikler önce yerel taslak olur, Etsy&apos;ye gitmez.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} disabled={!!noKey} className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs hover:border-[#F1641E] hover:text-[#F1641E] disabled:opacity-40 dark:border-neutral-700">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[92%] ${m.role === "user" ? "" : "w-full"}`}>
              {m.images.length > 0 && (
                <div className={`mb-1 flex flex-wrap gap-1.5 ${m.role === "user" ? "justify-end" : ""}`}>
                  {m.images.map((i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i.id} src={img(i.url)} alt="" className="h-20 w-20 rounded-lg object-cover" />
                  ))}
                </div>
              )}
              {m.content && (
                <div className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "ml-auto w-fit bg-[#F1641E] text-white" : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"}`}>
                  <Text text={m.content} />
                </div>
              )}
              {m.cards.map((c, i) => (
                <Card key={i} card={c} shopId={shopId} />
              ))}
            </div>
          </div>
        ))}
        {busy && <Thinking step={step} />}
        <div ref={bottom} />
      </div>

      {(error || noKey) && (
        <div className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error ?? "Seçili yapay zekâ sağlayıcısının API anahtarı tanımlı değil. Ayarlar > API anahtarları bölümünden ekleyin ya da yukarıdan diğer sağlayıcıyı seçin."}
        </div>
      )}

      <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
        {(pending.length > 0 || uploading > 0) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.name} className="h-14 w-14 rounded-lg object-cover" />
                <button type="button" onClick={() => setPending((x) => x.filter((i) => i.id !== p.id))} className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-neutral-800 text-[10px] text-white" aria-label="Kaldır">
                  ✕
                </button>
              </div>
            ))}
            {uploading > 0 && <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-neutral-100 text-[10px] text-neutral-500 dark:bg-neutral-800">yükleniyor</div>}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void addFiles(Array.from(e.target.files))} />
          <button type="button" onClick={() => fileInput.current?.click()} title="Resim ekle" className="rounded-xl border border-neutral-200 px-3 py-2 text-lg leading-none hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            rows={2}
            placeholder="Bir şey sor ya da yaptır… (Enter gönderir, Shift+Enter satır atlar)"
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-[#F1641E] focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || uploading > 0 || (!input.trim() && pending.length === 0) || !!noKey}
            className="rounded-xl bg-[#F1641E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d9560f] disabled:opacity-40"
          >
            Gönder
          </button>
        </div>
      </div>
      </div>

      <aside
        className={`${historyOpen ? "absolute right-2 top-14 z-20 flex h-[26rem] w-72 rounded-xl border border-neutral-200 shadow-xl dark:border-neutral-700" : "hidden"} flex-col bg-white dark:bg-neutral-900 xl:static xl:z-auto xl:h-auto xl:w-64 xl:flex-shrink-0 xl:rounded-none xl:border-0 xl:border-l xl:border-neutral-100 xl:shadow-none xl:dark:border-neutral-800`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2.5 dark:border-neutral-800">
          <span className="text-sm font-semibold">Geçmiş sohbetler</span>
          {sessions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
              }}
              className="text-xs font-medium text-[#F1641E] hover:underline"
            >
              {selectMode ? "İptal" : "Seç"}
            </button>
          )}
        </div>
        <button type="button" onClick={newChat} className="mx-2 mt-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-left text-sm font-medium text-[#F1641E] hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
          + Yeni sohbet
        </button>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {sessions.length === 0 && <p className="px-2 py-3 text-xs text-neutral-400">Kayıtlı sohbet yok.</p>}
          {sessions.map((s) => (
            <div key={s.id} className={`group flex items-center gap-1 rounded-lg ${s.id === sessionId ? "bg-orange-50 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}>
              {selectMode && <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} className="ml-2 h-4 w-4 flex-shrink-0 accent-[#F1641E]" aria-label={`${s.title} seç`} />}
              <button type="button" onClick={() => (selectMode ? toggleSelected(s.id) : void openSession(s.id))} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                <div className={`truncate text-sm ${s.id === sessionId ? "font-semibold" : ""}`}>{s.title}</div>
                <div className="text-[11px] text-neutral-400">{when(s.updated_at)}</div>
              </button>
              {!selectMode && (
                <button type="button" onClick={() => void removeSession(s.id)} title="Sil" className="px-2 text-xs text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {sessions.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
            {selectMode ? (
              <>
                <button type="button" onClick={() => setSelected(selected.size === sessions.length ? new Set() : new Set(sessions.map((x) => x.id)))} className="text-xs text-neutral-500 hover:underline">
                  {selected.size === sessions.length ? "Seçimi kaldır" : "Tümünü seç"}
                </button>
                <button type="button" onClick={() => void deleteSelected()} disabled={selected.size === 0} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  Sil ({selected.size})
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void deleteAll()} className="text-xs text-red-600 hover:underline">
                Tümünü sil
              </button>
            )}
          </div>
        )}
      </aside>
      {confirmElement}
    </div>
  );
}
