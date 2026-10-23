"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n-client";

// Tarayıcının kendi konuşma tanıması (Web Speech API): ücretsiz, sunucuya ses gitmez ama Chrome sesi Google'ın
// sunucusunda metne çevirir (bkz. Yapay Zekâ ve Veri İşleme sayfası). Chrome/Edge/Android'de çalışır; iPhone'da ana
// ekrana eklenmiş uygulamada çalışmayabilir, bu durumda hata verir ve düğme gizlenmez ama mesaj gösterilir.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

const subscribeNone = () => () => {};

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Konuşulanı `onText(taban + konuşma)` olarak verir; `taban` dinlemeye başlarken kutuda yazılı olan metindir. */
export function useSpeechInput(onText: (text: string) => void) {
  const { t, locale } = useT(); // locale: "tr-TR" ya da "en-US" (tanıma diliyle aynı biçim)
  // Sunucuda ve hidrasyon çiziminde false, tarayıcıda hemen sonra gerçek değer.
  const supported = useSyncExternalStore(subscribeNone, () => ctor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(
    (current: string) => {
      const C = ctor();
      if (!C) return;
      setError(null);
      const r = new C();
      r.lang = locale;
      r.continuous = true;
      r.interimResults = true;
      const base = current.trim();
      r.onresult = (e) => {
        let spoken = "";
        for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
        onText([base, spoken.trim()].filter(Boolean).join(" "));
      };
      r.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        setError(
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? t("Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver.", "Microphone permission was not granted. Allow it in the browser settings.")
            : t("Sesli yazma şu an çalışmıyor. Yazarak devam edebilirsin.", "Voice typing is not working right now. You can keep typing."),
        );
      };
      r.onend = () => {
        setListening(false);
        rec.current = null;
      };
      rec.current = r;
      try {
        r.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    [locale, onText, t],
  );

  const toggle = useCallback((current: string) => (rec.current ? stop() : start(current)), [start, stop]);

  return { supported, listening, error, toggle, stop };
}
