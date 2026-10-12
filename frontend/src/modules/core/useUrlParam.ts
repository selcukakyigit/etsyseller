"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** URL'deki tek bir sorgu parametresi (ör. `?job=12`): yenileyince ve geri tuşunda korunur. Boş değer URL'den silinir.
 * İlk render sunucuyla aynı olsun diye değer bağlandıktan sonra okunur (bkz. lib/useUrlTab.ts). */
export function useUrlParam(param: string): [string, (v: string) => void] {
  const router = useRouter();
  const read = useCallback(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(param) ?? ""), [param]);
  const [value, setValue] = useState("");
  useEffect(() => {
    // URL ancak tarayıcıda okunabilir; bağlandıktan sonra bir kez eşitlemek kaçınılmaz.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(read());
    const onPop = () => setValue(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [read]);
  const set = useCallback(
    (v: string) => {
      setValue(v);
      const url = new URL(window.location.href);
      if (v) url.searchParams.set(param, v);
      else url.searchParams.delete(param);
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    },
    [router, param],
  );
  return [value, set];
}
