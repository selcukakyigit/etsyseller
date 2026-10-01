// Küçük, bağımlılıksız bildirim (popup) deposu. Her yerden çağrılabilir: `toast.error("...")`.
// <Toaster /> (kök düzende) bu depoyu dinleyip sağ altta gösterir.
export type ToastKind = "error" | "success" | "info";
export type ToastItem = { id: number; kind: ToastKind; message: string };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const recent = new Map<string, number>(); // aynı mesajı kısa sürede tekrar tekrar gösterme

function emit() {
  listeners.forEach((l) => l());
}

function push(kind: ToastKind, message: string, ms: number) {
  const now = Date.now();
  if ((recent.get(message) ?? 0) > now - 8000) return; // 8 sn içinde aynı mesaj zaten gösterildi
  recent.set(message, now);
  const id = nextId++;
  items = [...items, { id, kind, message }].slice(-4); // en fazla 4 tane üst üste
  emit();
  setTimeout(() => toast.dismiss(id), ms);
}

export const toast = {
  error: (message: string) => push("error", message, 7000),
  success: (message: string) => push("success", message, 4000),
  info: (message: string) => push("info", message, 5000),
  dismiss(id: number) {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => items,
};
