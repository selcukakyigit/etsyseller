import { createEntityStore } from "../core/entityStore";
import { supplyApi } from "./api";

/** Tedarikçi listesi: kenar çubuğu ve Dış Tedarik sayfası paylaşır. */
export const supplyStore = createEntityStore(() => supplyApi.list());

/** Kenar çubuğundaki "+ Yeni tedarikçi": Dış Tedarik sayfası açıksa oluşturma formunu açar. */
