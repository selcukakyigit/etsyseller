const t = (tr) => tr; // gerçek useT gibi KARARLI (render'lar arasında aynı fonksiyon)
const value = { t, locale: "tr-TR", lang: "tr" };
export const useT = () => value;
export const useLang = () => "tr";
