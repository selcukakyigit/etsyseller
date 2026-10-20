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

## Every new capability must also be available to the assistant

The chat assistant (`backend/app/assistant/`) is a second front end of the product. When you add or change something a user can do on a screen
(editor action, generation option, report, setting, import), make it available to the assistant **in the same change**, without being asked.

- Expose it as an assistant tool that calls the **same backend function** the screen uses. Never write a second implementation for the assistant.
- Anything both sides need (prompt phrases, option lists, limits, prices) lives in ONE backend module that both import (e.g. `app/ai/camera.py`,
  `generation.upscale_options()`). The frontend sends choices (keys), not text the backend should have built.
- Register the tool everywhere it is needed in `assistant/tools.py`: the `TOOLS` schema, `EXECUTORS`, `TOOL_LABELS` and `TOOL_LABELS_EN`
  (plain, non-technical progress text), `LISTING_TOOL_NAMES`, `_DEFAULT_DRAFT_TOOLS` (listing-scoped tools), `WRITE_TOOLS` (draft-writing tools) and
  `TOOL_KIND` where it applies. New topic-specific tools go into a `TOOL_GROUPS` group instead of the core list.
- Mention it in `assistant/prompt.py` (when to use it, what it costs, what it never does). Tools that spend credits report the cost back.
- When you change behavior the assistant already uses (standards, prompts, limits, option lists), check `tools.py` and `prompt.py` too.
- If something is deliberately NOT for the assistant, say so in your final message so the user can overrule it.

## Account isolation (multi-tenant) — check on every new route, query and screen

Shops and workspaces of different customers must never see each other's data, and an invited supplier (guest) must never see shop, order,
finance, cost-split, external-share or profit data.

- Shop routes: `Depends(get_owned_shop)`. Module-entity routes: `entity_access(module)`, and `access.require_member()` for anything internal.
- Any sub-resource fetched by an id from the request (`db.get(Model, id)`) is checked against `entity_id` / `shop_id` / `workspace_id`; mismatch = 404.
- Reports, summaries and lists must not return internal fields to guests (`access.internal`).
- New table: enable RLS in its migration and tie it to `workspace_id` / `entity_id`.

## Long explanations go behind a "?" icon

Do not leave long help text, hints or notes always visible on a screen. Put them in `HelpTip` from `@/components/ui/HelpTip` next to the
title or field (hover on desktop, tap on mobile). Keep visible only: short labels, warnings the user must act on, and live results
(totals, errors). Write the tip text in both languages like any other UI text.

## Modals: steady size, long lists scroll inside

A modal must not grow or jump while the user works in it. Check this on every new modal.

- Use `Modal` from `@/components/listing-editor/Modal` (it caps at 90vh and scrolls its body). Set the width with `widthClass`; never let content decide it.
- A list that can grow (history, rows, search results) gets its own limit inside the modal: `max-h-80 overflow-auto` (about 20 rem). The modal does not get taller as the list gets longer.
- A modal with tabs or steps wraps its content in a fixed minimum height (`min-h-[...]`, sized to the tallest tab) so switching tabs does not resize the window.
- Empty, loading and filled states should take roughly the same space (spinner/empty text inside the same area).

## Number fields and display helpers

- Important numeric fields (price, credits, quantity, measures, durations, ids) never accept letters. Use the shared inputs from
  `@/components/ui/NumberInputs`: `IntegerInput`, `SignedIntegerInput`, `DecimalInput`, `MoneyInput` (prices: at most 2 decimals, padded on blur,
  currency symbol via `unit`), `NumberInput` (for `number` state). Do not write a bare `<input inputMode="decimal">`.
- Country names always come from `countryName()` in `@/lib/countries`. `Intl.DisplayNames.of()` throws `RangeError` on codes like "??" (unknown
  country), which crashes the page even with `fallback: "code"`.
