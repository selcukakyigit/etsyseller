"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  Personalization,
  PersonalizationLibraryItem,
  PersonalizationQuestion,
  PersonalizationQuestionType,
} from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal, btnGhost, btnPrimary } from "./Modal";
import { tNow as t } from "@/lib/i18n";

const MAX_QUESTIONS = 5;
const TITLE_MAX = 45;
const INSTRUCTIONS_MAX = 120;
const CHARS_MIN = 1;
const CHARS_MAX = 1024;
const FILES_MAX = 10;

type Kind = "text" | "list" | "upload";

const KIND_TEXT: Record<Kind, { label: [string, string]; hint: [string, string]; icon: string }> = {
  text: { label: ["Metin kutusu", "Text box"], hint: ["İsim, tarih veya alıntı gibi bilgiler toplayın", "Collect info like names, dates or quotes"], icon: "T|" },
  list: { label: ["Seçenek listesi", "Option list"], hint: ["Alıcının seçeceği seçenekler sunun", "Offer options for the buyer to pick"], icon: "☰" },
  upload: { label: ["Dosya yükleme", "File upload"], hint: ["Alıcılardan dosya isteyin", "Ask buyers for files"], icon: "▣" },
};
const KIND_LABELS = {
  get: (k: Kind) => ({ label: t(...KIND_TEXT[k].label), hint: t(...KIND_TEXT[k].hint), icon: KIND_TEXT[k].icon }),
};

const kindOf = (type: PersonalizationQuestionType): Kind =>
  type === "text_input" ? "text" : type === "dropdown" ? "list" : "upload";

function blank(kind: Kind): PersonalizationQuestion {
  return {
    question_id: null,
    question_text: "",
    instructions: "",
    question_type: kind === "text" ? "text_input" : kind === "list" ? "dropdown" : "unlabeled_upload",
    required: false,
    max_allowed_characters: kind === "text" ? 256 : null,
    max_allowed_files: kind === "upload" ? 1 : null,
    options: kind === "list" ? [{ label: "", option_id: null }] : [],
    add_on_price: null,
  };
}

function summary(q: PersonalizationQuestion): string {
  const kind = kindOf(q.question_type);
  const parts: string[] = [KIND_LABELS.get(kind).label, q.required ? t("Zorunlu", "Required") : t("İsteğe bağlı", "Optional")];
  if (kind === "list") parts.push(t(`${q.options.length} seçenek`, `${q.options.length} options`));
  else if (kind === "upload") parts.push(t(`${q.max_allowed_files ?? 1} dosya`, `${q.max_allowed_files ?? 1} files`));
  else if (q.instructions) parts.push(q.instructions);
  return parts.join(" • ");
}

const sameField = (a: PersonalizationQuestion, b: PersonalizationQuestion) =>
  a.question_text === b.question_text && a.question_type === b.question_type && a.instructions === b.instructions;

const inputCls =
  "rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#D97757]";
const labelCls = "mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-200";
const hintCls = "mb-1.5 text-xs text-neutral-500 dark:text-neutral-400";
const iconBtn =
  "rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800";

function Counter({ n, max }: { n: number; max: number }) {
  return <p className={`mt-1 text-right text-xs ${n > max ? "text-red-600" : "text-neutral-400"}`}>{n}/{max}</p>;
}

/** Alıcının göreceği görünüm: tüm alanlar, düzenlenen alan vurgulu. Seçenek listeleri gerçekten açılır —
 * sadece görsel mockup değil, alıcının göreceği seçenekleri kontrol edebilesin diye. */
function BuyerPreview({ questions, highlight }: { questions: PersonalizationQuestion[]; highlight: number }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="space-y-4">
        {questions.map((q, i) => {
          const kind = kindOf(q.question_type);
          return (
            <div key={i} className={i === highlight ? "rounded-lg bg-[#D97757]/5 p-2 -m-2" : ""}>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {q.question_text || <span className="text-neutral-400">{t("Alan başlığı", "Field title")}</span>}
                {!q.required && <span className="font-normal text-neutral-500"> {t("(isteğe bağlı)", "(optional)")}</span>}
              </p>
              {q.instructions && <p className="whitespace-pre-line text-xs text-neutral-500">{q.instructions}</p>}
              {kind === "text" && (
                <>
                  <div className="mt-1.5 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
                  <p className="mt-1 text-right text-xs text-neutral-400">0/{q.max_allowed_characters ?? 256}</p>
                </>
              )}
              {kind === "list" && (
                <div className="relative mt-1.5">
                  <button
                    type="button"
                    onClick={() => setOpenIdx(openIdx === i ? null : i)}
                    className="flex h-9 w-full items-center justify-between rounded-lg border border-neutral-300 px-3 text-sm text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300"
                  >
                    {t("Seçenek seç", "Select an option")} <span className={openIdx === i ? "rotate-180" : ""}>▾</span>
                  </button>
                  {openIdx === i && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                      {q.options.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-neutral-400">{t("Henüz seçenek eklenmedi", "No options added yet")}</p>
                      ) : (
                        q.options.map((o, oi) => (
                          <div
                            key={oi}
                            className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                          >
                            {o.label.trim() || <span className="text-neutral-400">{t("(boş seçenek)", "(empty option)")}</span>}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              {kind === "upload" && (
                <div className="mt-1.5 rounded-lg border border-dashed border-neutral-300 p-3 text-center text-xs text-neutral-500 dark:border-neutral-700">
                  {t("+ Dosyalarını ekle", "+ Add your files")}
                  <br />
                  {t(`En fazla ${q.max_allowed_files ?? 1} dosya`, `Up to ${q.max_allowed_files ?? 1} files`)}
                  {q.question_type === "labeled_upload" && q.options.length > 0 && (
                    <span className="mt-1 block text-neutral-400">{q.options.map((o) => o.label || "…").join(" · ")}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldEditor({
  initial,
  others,
  index,
  isNew,
  onCancel,
  onDone,
}: {
  initial: PersonalizationQuestion;
  /** Bu alan dışındaki alanlar (önizleme için, sırayla). */
  others: PersonalizationQuestion[];
  /** Önizlemede bu alanın konumu. */
  index: number;
  isNew: boolean;
  onCancel: () => void;
  onDone: (q: PersonalizationQuestion) => void;
}) {
  const [q, setQ] = useState(initial);
  const kind = kindOf(q.question_type);
  const patch = (p: Partial<PersonalizationQuestion>) => setQ((prev) => ({ ...prev, ...p }));
  const labeled = q.question_type === "labeled_upload";

  const labelledOptionsNeeded = kind === "list" || labeled;
  const valid =
    q.question_text.trim().length > 0 &&
    q.question_text.length <= TITLE_MAX &&
    (!labelledOptionsNeeded || q.options.some((o) => o.label.trim())) &&
    (kind !== "text" || ((q.max_allowed_characters ?? 0) >= CHARS_MIN && (q.max_allowed_characters ?? 0) <= CHARS_MAX));

  const preview = [...others.slice(0, index), q, ...others.slice(index)];

  return (
    <Modal
      z={95}
      widthClass="max-w-4xl"
      title={`${isNew ? t("Yeni", "New") : t("Düzenle:", "Edit:")} ${KIND_LABELS.get(kind).label.toLowerCase()}`}
      footer={
        <>
          <button onClick={onCancel} className={btnGhost}>
            {t("Vazgeç", "Cancel")}
          </button>
          <button onClick={() => onDone(q)} disabled={!valid} className={btnPrimary}>
            {t("Tamam", "Done")}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-5">
          <div>
            <label className={labelCls}>{t("Alan başlığı", "Field title")}</label>
            <p className={hintCls}>
              {kind === "upload" ? t("Alıcılara ne yüklemeleri gerektiğini söyleyin", "Tell buyers what to upload") : t("İhtiyacınız olan bilgiyi açıklayan bir başlık yazın", "Write a title that explains the info you need")}
            </p>
            <input
              value={q.question_text}
              onChange={(e) => patch({ question_text: e.target.value })}
              maxLength={TITLE_MAX}
              className={`${inputCls} w-full`}
            />
            <Counter n={q.question_text.length} max={TITLE_MAX} />
          </div>

          {kind === "upload" ? (
            <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
              <input type="checkbox" checked={q.required} onChange={(e) => patch({ required: e.target.checked })} className="h-4 w-4" />
              {t("Bu alan zorunlu", "This field is required")}
            </label>
          ) : (
            <div>
              <label className={labelCls}>{t("Bu alan alıcılar için zorunlu mu?", "Is this field required for buyers?")}</label>
              {[true, false].map((v) => (
                <label key={String(v)} className="flex items-center gap-2 py-0.5 text-sm text-neutral-800 dark:text-neutral-100">
                  <input type="radio" checked={q.required === v} onChange={() => patch({ required: v })} className="accent-[#D97757]" />
                  {v ? t("Evet, alıcılar doldurmak zorunda", "Yes, buyers must fill it in") : t("Hayır, isteğe bağlı", "No, it is optional")}
                </label>
              ))}
            </div>
          )}

          {q.add_on_price && (
            <p className="text-xs text-neutral-500">
              {t("Bu alanda Etsy'de tanımlı bir ek ücret var; olduğu gibi korunur (buradan düzenlenemez).", "This field has an add-on price set on Etsy; it is kept as is (it cannot be edited here).")}
            </p>
          )}

          {kind === "upload" && (
            <>
              <div>
                <label className={labelCls}>{t("İzin verilen dosya sayısı", "Number of files allowed")}</label>
                <p className={hintCls}>{t("Alıcılar .jpg, .png, .svg, .pdf ve .heic dosyaları ekleyebilir (100 MB'a kadar)", "Buyers can add .jpg, .png, .svg, .pdf and .heic files (up to 100 MB)")}</p>
                <select
                  value={q.max_allowed_files ?? 1}
                  onChange={(e) => patch({ max_allowed_files: Number(e.target.value) })}
                  className={`${inputCls} w-full`}
                >
                  {Array.from({ length: FILES_MAX }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                  <input
                    type="checkbox"
                    checked={labeled}
                    onChange={(e) =>
                      patch({
                        question_type: e.target.checked ? "labeled_upload" : "unlabeled_upload",
                        options: e.target.checked ? (q.options.length ? q.options : [{ label: "", option_id: null }]) : q.options,
                      })
                    }
                    className="h-4 w-4"
                  />
                  {t("Her dosyayı etiketle", "Label each file")}
                </label>
                <p className={`${hintCls} mt-1`}>{t("Yerleşimi belirtmek veya farklı fotoğraf açıları istemek için etiket ekleyin", "Add labels to specify placement or ask for different photo angles")}</p>
              </div>
            </>
          )}

          {kind !== "list" && (
            <div>
              <label className={labelCls}>{t("Talimat (isteğe bağlı)", "Instructions (optional)")}</label>
              <p className={hintCls}>{t("Alıcılara yardımcı olacak yönergeler verin", "Give buyers helpful directions")}</p>
              <textarea
                value={q.instructions}
                onChange={(e) => patch({ instructions: e.target.value })}
                rows={3}
                className={`${inputCls} w-full`}
              />
              <Counter n={q.instructions.length} max={INSTRUCTIONS_MAX} />
              {q.instructions.length > INSTRUCTIONS_MAX && (
                <p className="text-xs text-amber-600">
                  {t(
                    `Etsy'nin yeni sınırı ${INSTRUCTIONS_MAX} karakter; eski bir alan olduğu için korunuyor, ama düzenleyip yayınlarken Etsy reddedebilir.`,
                    `Etsy's new limit is ${INSTRUCTIONS_MAX} characters; this older field is kept, but Etsy may reject it when you edit and publish.`,
                  )}
                </p>
              )}
            </div>
          )}

          {kind === "text" && (
            <div>
              <label className={labelCls}>{t("Karakter sınırı", "Character limit")}</label>
              <p className={hintCls}>
                {t(`${CHARS_MIN} ile ${CHARS_MAX} arasında bir sınır belirleyin`, `Set a limit between ${CHARS_MIN} and ${CHARS_MAX}`)}
              </p>
              <input
                type="number"
                min={CHARS_MIN}
                max={CHARS_MAX}
                value={q.max_allowed_characters ?? ""}
                onChange={(e) => patch({ max_allowed_characters: e.target.value ? Number(e.target.value) : null })}
                className={`${inputCls} w-full`}
              />
            </div>
          )}

          {(kind === "list" || labeled) && (
            <div>
              <label className={labelCls}>{labeled ? t("Dosya etiketleri", "File labels") : t("Seçenekler", "Options")}</label>
              <ul className="space-y-2">
                {q.options.map((o, oi) => (
                  <li key={o.option_id ?? `o-${oi}`} className="flex items-center gap-2">
                    <input
                      value={o.label}
                      onChange={(e) => patch({ options: q.options.map((x, xi) => (xi === oi ? { ...x, label: e.target.value } : x)) })}
                      placeholder={`${labeled ? t("Etiket", "Label") : t("Seçenek", "Option")} ${oi + 1}`}
                      className={`min-w-0 ${inputCls} flex-1`}
                    />
                    <button
                      type="button"
                      className={`${iconBtn} text-red-600`}
                      disabled={q.options.length <= 1}
                      onClick={() => patch({ options: q.options.filter((_, xi) => xi !== oi) })}
                    >
                      {t("Kaldır", "Remove")}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`${iconBtn} mt-2 border border-neutral-200 dark:border-neutral-800`}
                onClick={() => patch({ options: [...q.options, { label: "", option_id: null }] })}
              >
                {labeled ? t("+ Etiket ekle", "+ Add label") : t("+ Seçenek ekle", "+ Add option")}
              </button>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-center text-xs font-semibold text-neutral-500">{t("Alıcılar bunu görecek", "Buyers will see this")}</p>
          <BuyerPreview questions={preview} highlight={index} />
        </div>
      </div>
    </Modal>
  );
}

/** Etsy'nin "Custom options" alanı (API'de personalization): en fazla 5 alan. Stoğu etkilemez. */
export default function PersonalizationEditor({
  shopId,
  value,
  onChange,
}: {
  shopId?: number;
  value: Personalization | null;
  onChange: (value: Personalization) => void;
}) {
  const [editing, setEditing] = useState<{ index: number; q: PersonalizationQuestion; isNew: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [library, setLibrary] = useState<PersonalizationLibraryItem[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirm, confirmElement] = useConfirm();
  const section = "rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4";

  // "Daha önce kullanılanlar": menü ilk açıldığında sunucudan (yerel önbellek) bir kez yüklenir.
  useEffect(() => {
    if (!menuOpen || library !== null || shopId === undefined) return;
    api.listings
      .personalizationLibrary(shopId)
      .then(setLibrary)
      .catch(() => setLibrary([]));
  }, [menuOpen, library, shopId]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const questions = useMemo(() => value?.questions ?? [], [value]);
  const reusable = useMemo(
    () => (library ?? []).filter((item) => !questions.some((q) => sameField(q, item))),
    [library, questions]
  );

  if (!value) {
    return (
      <section className={section}>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Kişiselleştirme (Özel seçenekler)", "Personalization (custom options)")}</h2>
        <p className="text-sm text-neutral-400">{t("Kişiselleştirme bilgisi Etsy'den okunamadı.", "Personalization could not be read from Etsy.")}</p>
      </section>
    );
  }

  const setQuestions = (next: PersonalizationQuestion[]) => onChange({ questions: next });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...questions];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setQuestions(next);
  };

  async function remove(i: number) {
    const ok = await confirm({
      title: t("Alan silinsin mi?", "Delete field?"),
      message: t(
        `"${questions[i].question_text || "Adsız alan"}" kaldırılacak. Değişiklik Etsy'ye yayınlayınca uygulanır.`,
        `"${questions[i].question_text || "Untitled field"}" will be removed. The change applies when you publish to Etsy.`,
      ),
      confirmLabel: t("Sil", "Delete"),
      destructive: true,
    });
    if (ok) setQuestions(questions.filter((_, idx) => idx !== i));
  }

  function addFromLibrary(item: PersonalizationLibraryItem) {
    const { count: _count, ...q } = item;
    void _count;
    setQuestions([...questions, { ...q, question_id: null, options: q.options.map((o) => ({ ...o, option_id: null })) }]);
    setMenuOpen(false);
  }

  const full = questions.length >= MAX_QUESTIONS;

  return (
    <section className={section}>
      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("Kişiselleştirme (Özel seçenekler)", "Personalization (custom options)")}</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t(
            `Alıcılardan metin, görsel veya isim gibi bilgiler toplamak için en fazla ${MAX_QUESTIONS} alan oluştur. Mevcut stoğu etkilemez.`,
            `Create up to ${MAX_QUESTIONS} fields to collect info like text, images or names from buyers. It does not affect inventory.`,
          )}
        </p>
      </div>

      <ul className="space-y-2">
        {questions.map((q, i) => (
          <li
            key={q.question_id ?? `new-${i}`}
            className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800"
          >
            <span className="w-6 text-center text-xs text-neutral-400" aria-hidden>
              {KIND_LABELS.get(kindOf(q.question_type)).icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {q.question_text || <span className="text-neutral-400">{t("Adsız alan", "Untitled field")}</span>}
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{summary(q)}</p>
            </div>
            <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Yukarı taşı", "Move up")}>
              ↑
            </button>
            <button
              type="button"
              className={iconBtn}
              disabled={i === questions.length - 1}
              onClick={() => move(i, 1)}
              aria-label={t("Aşağı taşı", "Move down")}
            >
              ↓
            </button>
            <button type="button" className={iconBtn} onClick={() => setEditing({ index: i, q: structuredClone(q), isNew: false })}>
              {t("Düzenle", "Edit")}
            </button>
            <button type="button" className={`${iconBtn} text-red-600`} onClick={() => remove(i)}>
              {t("Sil", "Delete")}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={full}
            className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {t("+ Alan ekle", "+ Add field")}
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-40 mt-2 max-h-80 w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-xl border border-neutral-200 bg-white py-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
              {reusable.length > 0 && (
                <>
                  <p className="px-4 pb-1 pt-1 text-[11px] font-medium text-neutral-500">{t("Daha önce kullanılanlar", "Used before")}</p>
                  {reusable.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => addFromLibrary(item)}
                      className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <span className="mt-0.5 w-5 text-center text-xs text-neutral-500">{KIND_LABELS.get(kindOf(item.question_type)).icon}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-neutral-900 dark:text-neutral-100">{item.question_text}</span>
                        <span className="block truncate text-xs text-neutral-500">
                          {summary(item)}
                          {item.count > 1 ? t(` · ${item.count} listing'de`, ` · in ${item.count} listings`) : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
                </>
              )}
              <p className="px-4 pb-1 pt-1 text-[11px] font-medium text-neutral-500">{t("Yeni oluştur", "Create new")}</p>
              {(Object.keys(KIND_TEXT) as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing({ index: questions.length, q: blank(k), isNew: true });
                  }}
                  className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <span className="mt-0.5 w-5 text-center text-xs text-neutral-500">{KIND_LABELS.get(k).icon}</span>
                  <span>
                    <span className="block text-sm text-neutral-900 dark:text-neutral-100">{KIND_LABELS.get(k).label}</span>
                    <span className="block text-xs text-neutral-500">{KIND_LABELS.get(k).hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {t(`${questions.length}/${MAX_QUESTIONS} alan kullanılıyor`, `${questions.length}/${MAX_QUESTIONS} fields used`)}
        </span>
      </div>

      {editing && (
        <FieldEditor
          initial={editing.q}
          others={questions.filter((_, i) => i !== (editing.isNew ? -1 : editing.index))}
          index={editing.index}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onDone={(q) => {
            setQuestions(editing.isNew ? [...questions, q] : questions.map((old, i) => (i === editing.index ? q : old)));
            setEditing(null);
          }}
        />
      )}
      {confirmElement}
    </section>
  );
}
