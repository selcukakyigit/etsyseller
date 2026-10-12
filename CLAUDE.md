# Ulagg — project rules

## Every new UI piece must ship with both languages and both themes

Do this from the start, for every new page, component, message or notification. Do not add it later.

**Two languages (Turkish + English).**
- Client components: `const { t, locale } = useT()` from `@/lib/i18n-client`, then `t("Türkçe", "English")`.
  Format dates and numbers with `locale`, not a hard-coded `"tr-TR"`.
- Code that cannot use hooks (helpers, `lib/*`, toasts, API errors): `tNow("Türkçe", "English")` from `@/lib/i18n`.
- Backend text the user sees: `tr("Türkçe", "English")` from `app/core/i18n.py`. Fixed error messages that go
  through `HTTPException` are translated from the `EN_MESSAGES` / `EN_PREFIXES` dictionary there; add new ones.
- The language comes from the `ulagg_lang` cookie (set by `src/proxy.ts`: Turkey → tr, everywhere else → en; the
  EN/TR switch changes it). The frontend sends it to the backend in the `X-Lang` header.

**Light and dark theme.**
- Every color class needs its `dark:` pair (e.g. `bg-white dark:bg-neutral-900`, `text-neutral-900 dark:text-neutral-100`,
  `border-neutral-200 dark:border-neutral-800`). Check new screens in both themes.
- Brand accent is `#D97757` (hover `#C6613F`). Do not use Etsy's orange (`#F1641E`).

## Other conventions
- Loading states: `PageSpinner` / `BlockSpinner` / `Spinner` from `@/components/ui/Spinner`, not "Yükleniyor…" text.
- Page data that is shown again when the user comes back: `useCached(key)` from `@/lib/pageCache`.
- The demo shop (`shops.is_demo`) never calls Etsy; `EtsyClient` raises `DemoShopError`.

## Account isolation (multi-tenant) — check on every new route, query and screen

Shops and workspaces of different customers must never see each other's data, and an invited supplier (guest) must never see shop, order,
finance, cost-split, external-share or profit data.

- Shop routes: `Depends(get_owned_shop)`. Module-entity routes: `entity_access(module)`, and `access.require_member()` for anything internal.
- Any sub-resource fetched by an id from the request (`db.get(Model, id)`) is checked against `entity_id` / `shop_id` / `workspace_id`; mismatch = 404.
- Reports, summaries and lists must not return internal fields to guests (`access.internal`).
- New table: enable RLS in its migration and tie it to `workspace_id` / `entity_id`.

## Number fields and display helpers

- Important numeric fields (price, credits, quantity, measures, durations, ids) never accept letters. Use the shared inputs from
  `@/components/ui/NumberInputs`: `IntegerInput`, `SignedIntegerInput`, `DecimalInput`, `MoneyInput` (prices: at most 2 decimals, padded on blur,
  currency symbol via `unit`), `NumberInput` (for `number` state). Do not write a bare `<input inputMode="decimal">`.
- Country names always come from `countryName()` in `@/lib/countries`. `Intl.DisplayNames.of()` throws `RangeError` on codes like "??" (unknown
  country), which crashes the page even with `fallback: "code"`.
