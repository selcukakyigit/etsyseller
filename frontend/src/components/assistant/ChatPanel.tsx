"use client";

import { ChangeEvent, ClipboardEvent, DragEvent, Fragment, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, API_URL, ChatMessageOut, ChatSessionInfo } from "@/lib/api";
import Card from "./Cards";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import UlaggMark from "@/components/brand/UlaggMark";
import { useT } from "@/lib/i18n-client";
import { Spinner } from "@/components/ui/Spinner";
import { ArrowUpIcon, CameraIcon, ImageIcon, PaperclipIcon, PlusIcon } from "@/components/icons";

const SUGGESTIONS: [string, string][] = [
  ["Bu ayın kâr-zarar durumu nedir?", "What is this month's profit and loss?"],
  ["Bu yıl en çok hangi ülkeye satış yaptık?", "Which country did we sell to most this year?"],
  ["Gönderilmesi gereken siparişleri göster", "Show the orders that need to ship"],
  ["Geçen yıla göre satışlarımız nasıl?", "How are sales compared to last year?"],
  ["Bu resimlerden yeni bir listing taslağı oluştur", "Create a new listing draft from these images"],
];

// Başlıktaki iki düğme (Geçmiş, Yeni sohbet) aynı boyda.
const pill =
  "inline-flex h-7 items-center whitespace-nowrap rounded-lg border border-neutral-200 px-2.5 text-xs text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800";

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

/** "Düşünüyor" göstergesi: çizilen Ulagg işareti + asistanın o an yaptığı iş (sunucudan gelir). */
function Thinking({ step }: { step: string }) {
  const { t } = useT();
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-3 rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        <UlaggMark animated size={22} />
        <span className="transition-opacity">{step || t("Düşünüyor", "Thinking")}…</span>
      </div>
    </div>
  );
}

type Pending = { id: string; url: string; name: string; isImage: boolean };

// Sohbete eklenebilen belgeler (kargo/gümrük faturası); resimler ayrıca kabul edilir. Sunucu sınırı 15 MB.
const DOC_EXT = [".pdf", ".csv", ".xlsx", ".xls", ".html", ".htm"];
const MAX_FILE_MB = 15;
const isDoc = (f: File) => DOC_EXT.some((ext) => f.name.toLowerCase().endsWith(ext));

/** Resim olmayan ekin (PDF, Excel…) küçük kutusu. */
function FileChip({ name, size = "h-14 w-14" }: { name: string; size?: string }) {
  const ext = name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "";
  return (
    <div title={name} className={`flex ${size} flex-col items-center justify-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 px-1 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300`}>
      <span className="text-lg leading-none">📄</span>
      <span className="text-[10px] font-semibold">{ext}</span>
    </div>
  );
}

/** Saklama süresi dolup silinmiş ek (90 gün, bkz. backend assistant/cleanup.py). */
function ExpiredChip({ name }: { name: string }) {
  const { t } = useT();
  return (
    <div
      title={t(`${name}: saklama süresi dolduğu için silindi`, `${name}: deleted after the retention period`)}
      className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 px-1 text-center text-neutral-400 dark:border-neutral-700 dark:text-neutral-500"
    >
      <span className="text-base leading-none">⌛</span>
      <span className="text-[10px] leading-tight">{t("Süresi doldu", "Expired")}</span>
    </div>
  );
}

export default function ChatPanel({
  shopId,
  onSent,
  heightClass = "h-[calc(100vh-11rem)] min-h-[32rem]",
}: {
  shopId: number;
  onSent?: () => void;
  /** Sohbet kutusunun yüksekliği (sayfa düzenine göre). */
  heightClass?: string;
}) {
  const { t, lang } = useT();
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
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
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [touch, setTouch] = useState(false); // dokunmatik cihazda menüde "Kamera" da görünür
  const [confirm, confirmElement] = useConfirm();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [todayKey] = useState(localToday); // "bugün / dün" etiketleri için
  const tempSeq = useRef(0); // geçici (henüz sunucuya yazılmamış) mesajlar için negatif kimlik

  const refreshSessions = useCallback(() => {
    api.assistant.sessions(shopId).then(setSessions).catch(() => undefined);
  }, [shopId]);

  useEffect(() => {
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
    const accepted = files.filter((f) => f.type.startsWith("image/") || isDoc(f));
    if (accepted.length < files.length) {
      setError(t("Yalnızca resim, PDF, Excel/CSV ya da HTML dosyası eklenebilir.", "Only images, PDF, Excel/CSV or HTML files can be attached."));
    }
    const tooBig = accepted.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig.length) setError(t(`Dosya ${MAX_FILE_MB} MB'dan büyük olamaz: ${tooBig[0].name}`, `The file cannot be larger than ${MAX_FILE_MB} MB: ${tooBig[0].name}`));
    const images = accepted.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024).slice(0, 6 - pending.length);
    if (images.length === 0) return;
    if (!tooBig.length && accepted.length === files.length) setError(null);
    setUploading((n) => n + images.length);
    for (const f of images) {
      try {
        const up = await api.assistant.uploadImage(shopId, f);
        const isImage = up.content_type.startsWith("image/");
        setPending((p) => [...p, { id: up.id, url: isImage ? URL.createObjectURL(f) : "", name: f.name, isImage }]);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : t("Dosya yüklenemedi", "File upload failed"));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // aynı dosya yeniden seçilebilsin
    if (files.length) void addFiles(files);
  }

  // Mesaj kutusu yazdıkça büyür (en fazla 160 px), gönderince tek satıra döner.
  useEffect(() => {
    const el = textArea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

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
      images: imgs.map((i) => ({ id: i.id, url: i.url, filename: i.name, content_type: i.isImage ? "image/*" : "application/octet-stream" })), cards: [],
    };
    setMessages((m) => [...m, temp]);
    setInput("");
    setPending([]);
    try {
      const reply = await api.assistant.chat(shopId, { message, session_id: sessionId, image_ids: imgs.map((i) => i.id), today: localToday(), request_id: rid, lang });
      setSessionId(reply.session_id);
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), { ...reply.user, images: temp.images }, reply.assistant]);
      refreshSessions();
      onSent?.();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInput(message);
      setPending(imgs);
      setError(e instanceof Error ? e.message : t("Mesaj gönderilemedi", "Message could not be sent"));
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
      setError(e instanceof Error ? e.message : t("Sohbet açılamadı", "Chat could not be opened"));
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
    const ok = await confirm({ title: t("Sohbet silinsin mi?", "Delete this chat?"), message: t("Bu sohbet kalıcı olarak silinir.", "This chat will be deleted permanently."), confirmLabel: t("Sil", "Delete"), destructive: true });
    if (!ok) return;
    await api.assistant.deleteSession(shopId, id).catch(() => undefined);
    if (id === sessionId) newChat();
    refreshSessions();
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const ok = await confirm({ title: t(`${selected.size} sohbet silinsin mi?`, `Delete ${selected.size} chats?`), message: t("Seçili sohbetler kalıcı olarak silinir.", "The selected chats will be deleted permanently."), confirmLabel: t("Sil", "Delete"), destructive: true });
    if (!ok) return;
    const ids = [...selected];
    await api.assistant.deleteSessions(shopId, ids).catch(() => undefined);
    if (sessionId !== null && ids.includes(sessionId)) newChat();
    setSelected(new Set());
    setSelectMode(false);
    refreshSessions();
  }

  async function deleteAll() {
    const ok = await confirm({ title: t("Tüm sohbetler silinsin mi?", "Delete all chats?"), message: t(`${sessions.length} sohbetin tamamı kalıcı olarak silinir.`, `All ${sessions.length} chats will be deleted permanently.`), confirmLabel: t("Hepsini sil", "Delete all"), destructive: true });
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
    if (key === todayKey) return `${t("bugün", "today")} ${hm}`;
    const y = new Date(`${todayKey}T00:00:00`);
    y.setDate(y.getDate() - 1);
    const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    return key === yKey ? `${t("dün", "yesterday")} ${hm}` : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }

  const img = (url: string) => (url.startsWith("blob:") || url.startsWith("http") ? url : `${API_URL}${url}`);

  return (
    <div
      className={`relative flex ${heightClass} rounded-2xl border bg-white dark:bg-neutral-900 ${dragging ? "border-[#D97757]" : "border-neutral-200 dark:border-neutral-800"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2.5 dark:border-neutral-800 sm:px-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 px-1 py-1 text-sm font-semibold sm:px-2">
            <UlaggMark size={18} />
            <span className="hidden sm:inline">Ulagg</span>
          </span>
          <button type="button" onClick={() => setHistoryOpen((v) => !v)} className={pill}>
            {historyOpen ? t("Geçmişi gizle", "Hide history") : `${t("Geçmiş", "History")} (${sessions.length})`}
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={newChat} className={pill}>
            {t("Yeni sohbet", "New chat")}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-6 text-center">
            <UlaggMark size={40} className="mx-auto mb-3" />
            <div className="mb-1 text-lg font-semibold">{t("Mağazanı buradan yönet", "Manage your shop from here")}</div>
            <p className="mb-4 text-sm text-neutral-500">
              {t(
                "Sor, listing oluştur, kâr-zarar durumuna bak. Resimleri ve kargo faturalarını (PDF, Excel, fotoğraf) sürükleyip bırakabilir ya da yapıştırabilirsin. Değişiklikler önce yerel taslak olur, Etsy'ye gitmez.",
                "Ask questions, create listings, check profit and loss. You can drag and drop or paste images and shipping invoices (PDF, Excel, photo). Changes are saved as local drafts first and are not sent to Etsy.",
              )}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map(([tr, en]) => t(tr, en)).map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs hover:border-[#D97757] hover:text-[#D97757] disabled:opacity-40 dark:border-neutral-700">
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
                  {m.images.map((i) =>
                    i.expired ? (
                      <ExpiredChip key={i.id} name={i.filename ?? t("dosya", "file")} />
                    ) : i.content_type && !i.content_type.startsWith("image/") ? (
                      <FileChip key={i.id} name={i.filename ?? "dosya"} size="h-20 w-20" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i.id} src={img(i.url)} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    ),
                  )}
                </div>
              )}
              {m.content && (
                <div className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "ml-auto w-fit bg-[#D97757] text-white" : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"}`}>
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

      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
        {(pending.length > 0 || uploading > 0) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div key={p.id} className="relative">
                {p.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.name} className="h-14 w-14 rounded-lg object-cover" />
                ) : (
                  <FileChip name={p.name} />
                )}
                <button type="button" onClick={() => setPending((x) => x.filter((i) => i.id !== p.id))} className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-neutral-800 text-[10px] text-white" aria-label={t("Kaldır", "Remove")}>
                  ✕
                </button>
              </div>
            ))}
            {uploading > 0 && (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <Spinner size={18} />
              </div>
            )}
          </div>
        )}
        {/* Kamera / fotoğraflar / dosyalar ayrı seçicilerle açılır; "capture" telefonda doğrudan kamerayı açar. */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
        <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={onPick} />
        <input ref={fileInput} type="file" accept={DOC_EXT.join(",")} multiple hidden onChange={onPick} />
        <div className="relative flex items-end gap-1.5 rounded-3xl border border-neutral-200 bg-neutral-50 p-1.5 transition-colors focus-within:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800/70 dark:focus-within:border-neutral-600">
          <button
            type="button"
            onClick={() => {
              setTouch(window.matchMedia("(pointer: coarse)").matches);
              setMenuOpen((v) => !v);
            }}
            aria-label={t("Ekle", "Add")}
            aria-expanded={menuOpen}
            title={t("Resim ya da dosya ekle (en fazla 15 MB)", "Add an image or file (up to 15 MB)")}
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700 ${menuOpen ? "rotate-45 bg-neutral-200 dark:bg-neutral-700" : ""}`}
          >
            <PlusIcon />
          </button>
          {menuOpen && (
            <>
              <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
              <div role="menu" className="absolute bottom-full left-0 z-20 mb-2 w-52 overflow-hidden rounded-2xl border border-neutral-200 bg-white py-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                {(
                  [
                    ...(touch ? [[cameraInput, CameraIcon, t("Kamera", "Camera")] as const] : []),
                    [photoInput, ImageIcon, t("Fotoğraflar", "Photos")] as const,
                    [fileInput, PaperclipIcon, t("Dosyalar", "Files")] as const,
                  ] as const
                ).map(([ref, Icon, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      ref.current?.click();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Icon className="text-neutral-500 dark:text-neutral-400" />
                    {label}
                  </button>
                ))}
                <p className="border-t border-neutral-100 px-4 pb-1 pt-2 text-[11px] leading-snug text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                  {t("PDF, Excel/CSV, HTML · en fazla 15 MB", "PDF, Excel/CSV, HTML · up to 15 MB")}
                </p>
              </div>
            </>
          )}
          <textarea
            ref={textArea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            rows={1}
            enterKeyHint="send"
            placeholder={t("Ulagg'a sor ya da yaptır…", "Ask Ulagg or have it do something…")}
            title={t("Enter gönderir, Shift+Enter satır atlar", "Enter sends, Shift+Enter adds a line")}
            className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-5 text-neutral-900 sm:text-sm placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || uploading > 0 || (!input.trim() && pending.length === 0)}
            aria-label={t("Gönder", "Send")}
            title={t("Gönder", "Send")}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#D97757] text-white transition hover:bg-[#C6613F] disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500"
          >
            {busy ? <UlaggMark animated size={20} /> : <ArrowUpIcon />}
          </button>
        </div>
      </div>
      </div>

      <aside
        className={`${historyOpen ? "absolute inset-x-2 top-14 z-20 flex h-[26rem] rounded-xl sm:left-auto sm:w-72 border border-neutral-200 shadow-xl dark:border-neutral-700" : "hidden"} flex-col bg-white dark:bg-neutral-900 xl:static xl:z-auto xl:h-auto xl:w-64 xl:flex-shrink-0 xl:rounded-none xl:border-0 xl:border-l xl:border-neutral-100 xl:shadow-none xl:dark:border-neutral-800`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2.5 dark:border-neutral-800">
          <span className="text-sm font-semibold">{t("Geçmiş sohbetler", "Past chats")}</span>
          {sessions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
              }}
              className="text-xs font-medium text-[#D97757] hover:underline"
            >
              {selectMode ? t("İptal", "Cancel") : t("Seç", "Select")}
            </button>
          )}
        </div>
        <button type="button" onClick={newChat} className="mx-2 mt-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-left text-sm font-medium text-[#D97757] hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
          + {t("Yeni sohbet", "New chat")}
        </button>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {sessions.length === 0 && <p className="px-2 py-3 text-xs text-neutral-400">{t("Kayıtlı sohbet yok.", "No saved chats.")}</p>}
          {sessions.map((s) => (
            <div key={s.id} className={`group flex items-center gap-1 rounded-lg ${s.id === sessionId ? "bg-orange-50 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}>
              {selectMode && <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} className="ml-2 h-4 w-4 flex-shrink-0 accent-[#D97757]" aria-label={t(`${s.title} seç`, `Select ${s.title}`)} />}
              <button type="button" onClick={() => (selectMode ? toggleSelected(s.id) : void openSession(s.id))} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                <div className={`truncate text-sm ${s.id === sessionId ? "font-semibold" : ""}`}>{s.title}</div>
                <div className="text-[11px] text-neutral-400">{when(s.updated_at)}</div>
              </button>
              {!selectMode && (
                <button type="button" onClick={() => void removeSession(s.id)} title={t("Sil", "Delete")} className="px-2 text-xs text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
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
                  {selected.size === sessions.length ? t("Seçimi kaldır", "Clear selection") : t("Tümünü seç", "Select all")}
                </button>
                <button type="button" onClick={() => void deleteSelected()} disabled={selected.size === 0} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  {t("Sil", "Delete")} ({selected.size})
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void deleteAll()} className="text-xs text-red-600 hover:underline">
                {t("Tümünü sil", "Delete all")}
              </button>
            )}
          </div>
        )}
      </aside>
      {confirmElement}
    </div>
  );
}
