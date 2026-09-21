"use client";

import { useState } from "react";
import { Personalization, PersonalizationQuestion, PersonalizationQuestionType } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const MAX_QUESTIONS = 5;

const TYPE_LABELS: Record<PersonalizationQuestionType, string> = {
  text_input: "Metin kutusu",
  dropdown: "Seçenek listesi",
  unlabeled_upload: "Görsel yükleme",
  labeled_upload: "Etiketli görsel yükleme",
};

const inputCls =
  "rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 px-3 py-2 text-sm outline-none focus:border-[#F1641E]";
const labelCls = "mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400";
const iconBtn =
  "rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800";

function summary(q: PersonalizationQuestion): string {
  const parts = [TYPE_LABELS[q.question_type] ?? q.question_type, q.required ? "Zorunlu" : "İsteğe bağlı"];
  if (q.question_type === "dropdown" || q.question_type === "labeled_upload") parts.push(`${q.options.length} seçenek`);
  else if (q.instructions) parts.push(q.instructions);
  return parts.join(" • ");
}

function blank(type: PersonalizationQuestionType): PersonalizationQuestion {
  return {
    question_id: null,
    question_text: "",
    instructions: "",
    question_type: type,
    required: false,
    max_allowed_characters: type === "text_input" ? 256 : null,
    max_allowed_files: type === "unlabeled_upload" || type === "labeled_upload" ? 1 : null,
    options: type === "dropdown" || type === "labeled_upload" ? [{ label: "", option_id: null }] : [],
    add_on_price: null,
  };
}

/** Etsy'nin "Custom options" alanı: en fazla 5 soru (metin, seçenek listesi, görsel yükleme). Stoğu etkilemez. */
export default function PersonalizationEditor({
  value,
  onChange,
}: {
  value: Personalization | null;
  onChange: (value: Personalization) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [newType, setNewType] = useState<PersonalizationQuestionType>("text_input");
  const [confirm, confirmElement] = useConfirm();
  const section = "rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4";

  if (!value) {
    return (
      <section className={section}>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Özel seçenekler</h2>
        <p className="text-sm text-neutral-400">Kişiselleştirme bilgisi Etsy&apos;den okunamadı.</p>
      </section>
    );
  }

  const questions = value.questions;
  const setQuestions = (next: PersonalizationQuestion[]) => onChange({ questions: next });
  const update = (i: number, patch: Partial<PersonalizationQuestion>) =>
    setQuestions(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...questions];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setQuestions(next);
    setEditing((e) => (e === i ? i + dir : e === i + dir ? i : e));
  };

  async function remove(i: number) {
    const ok = await confirm({
      title: "Alan silinsin mi?",
      message: `"${questions[i].question_text || "Adsız alan"}" kaldırılacak. Değişiklik Etsy'ye yayınlayınca uygulanır.`,
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setQuestions(questions.filter((_, idx) => idx !== i));
    setEditing(null);
  }

  function add() {
    setQuestions([...questions, blank(newType)]);
    setEditing(questions.length);
  }

  return (
    <section className={section}>
      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Özel seçenekler</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Alıcılardan metin, görsel veya isim gibi bilgiler toplamak için en fazla {MAX_QUESTIONS} alan oluştur. Mevcut
          stoğu etkilemez.
        </p>
      </div>

      <ul className="space-y-2">
        {questions.map((q, i) => (
          <li key={q.question_id ?? `new-${i}`} className="rounded-xl border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {q.question_text || <span className="text-neutral-400">Adsız alan</span>}
                </p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{summary(q)}</p>
              </div>
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Yukarı taşı">
                ↑
              </button>
              <button
                type="button"
                className={iconBtn}
                disabled={i === questions.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Aşağı taşı"
              >
                ↓
              </button>
              <button type="button" className={iconBtn} onClick={() => setEditing(editing === i ? null : i)}>
                {editing === i ? "Kapat" : "Düzenle"}
              </button>
              <button type="button" className={`${iconBtn} text-red-600`} onClick={() => remove(i)}>
                Sil
              </button>
            </div>

            {editing === i && (
              <div className="space-y-3 border-t border-neutral-100 px-3 py-3 dark:border-neutral-800">
                <div>
                  <label className={labelCls}>Alan türü</label>
                  <select
                    value={q.question_type}
                    onChange={(e) => {
                      const t = e.target.value as PersonalizationQuestionType;
                      const base = blank(t);
                      update(i, {
                        question_type: t,
                        max_allowed_characters: base.max_allowed_characters,
                        max_allowed_files: base.max_allowed_files,
                        options: base.options.length ? (q.options.length ? q.options : base.options) : [],
                      });
                    }}
                    className={`${inputCls} w-full sm:w-64`}
                  >
                    {(Object.keys(TYPE_LABELS) as PersonalizationQuestionType[]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Alan başlığı (alıcı bunu görür)</label>
                  <input
                    value={q.question_text}
                    onChange={(e) => update(i, { question_text: e.target.value })}
                    placeholder="Örn: Üst yazı, Font seçimi"
                    className={`${inputCls} w-full`}
                  />
                </div>

                {q.question_type !== "dropdown" && (
                  <div>
                    <label className={labelCls}>Talimat</label>
                    <input
                      value={q.instructions}
                      onChange={(e) => update(i, { instructions: e.target.value })}
                      placeholder="Örn: Kadın ve erkek isimlerini girin"
                      className={`${inputCls} w-full`}
                    />
                  </div>
                )}

                {q.question_type === "text_input" && (
                  <div>
                    <label className={labelCls}>Maks. karakter</label>
                    <input
                      type="number"
                      min={1}
                      value={q.max_allowed_characters ?? ""}
                      onChange={(e) => update(i, { max_allowed_characters: e.target.value ? Number(e.target.value) : null })}
                      className={`${inputCls} w-28`}
                    />
                  </div>
                )}

                {(q.question_type === "unlabeled_upload" || q.question_type === "labeled_upload") && (
                  <div>
                    <label className={labelCls}>Maks. dosya sayısı</label>
                    <input
                      type="number"
                      min={1}
                      value={q.max_allowed_files ?? ""}
                      onChange={(e) => update(i, { max_allowed_files: e.target.value ? Number(e.target.value) : null })}
                      className={`${inputCls} w-28`}
                    />
                  </div>
                )}

                {(q.question_type === "dropdown" || q.question_type === "labeled_upload") && (
                  <div>
                    <label className={labelCls}>Seçenekler</label>
                    <ul className="space-y-2">
                      {q.options.map((o, oi) => (
                        <li key={o.option_id ?? `o-${oi}`} className="flex items-center gap-2">
                          <input
                            value={o.label}
                            onChange={(e) =>
                              update(i, { options: q.options.map((x, xi) => (xi === oi ? { ...x, label: e.target.value } : x)) })
                            }
                            placeholder={`Seçenek ${oi + 1}`}
                            className={`${inputCls} flex-1`}
                          />
                          <button
                            type="button"
                            className={`${iconBtn} text-red-600`}
                            disabled={q.options.length <= 1}
                            onClick={() => update(i, { options: q.options.filter((_, xi) => xi !== oi) })}
                          >
                            Kaldır
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className={`${iconBtn} mt-2 border border-neutral-200 dark:border-neutral-800`}
                      onClick={() => update(i, { options: [...q.options, { label: "", option_id: null }] })}
                    >
                      + Seçenek ekle
                    </button>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => update(i, { required: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Zorunlu alan
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <select value={newType} onChange={(e) => setNewType(e.target.value as PersonalizationQuestionType)} className={inputCls}>
          {(Object.keys(TYPE_LABELS) as PersonalizationQuestionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={questions.length >= MAX_QUESTIONS}
          className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          + Alan ekle
        </button>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {questions.length}/{MAX_QUESTIONS} alan kullanılıyor
        </span>
      </div>
      {confirmElement}
    </section>
  );
}
