export const apiRequest = (...args) => globalThis.__api(...args);
export const apiUpload = (...args) => globalThis.__upload(...args);
export const API_URL = "";
// Adlandırılmış `api` nesnesini kullanan bileşenler (ör. PublishBar → publishJobs) çizilebilsin: her yöntem sahte istek işlevine gider.
export const api = new Proxy({}, { get: () => new Proxy({}, { get: () => (...args) => globalThis.__api?.(...args) }) });
