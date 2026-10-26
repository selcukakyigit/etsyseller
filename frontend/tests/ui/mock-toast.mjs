export const toast = { success: () => {}, error: (m) => globalThis.__toasts?.push(m), info: (m) => globalThis.__infos?.push(m) };
