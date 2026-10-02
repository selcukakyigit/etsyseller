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
