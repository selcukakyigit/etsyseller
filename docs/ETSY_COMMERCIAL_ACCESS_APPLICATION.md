# Ulagg — Etsy Commercial Access request

Draft text for the "Request Commercial Access" form. Paste the sections the form asks for.
Items in [brackets] must be filled in before sending.

---

## App summary

Ulagg (https://ulagg.com) is a web application for Etsy sellers. It helps them manage listings,
fulfil orders, and see the real profit of each order and product. Sellers connect their own shop with
Etsy OAuth 2.0 (PKCE). Ulagg reads and writes data only for shops whose owners have granted consent.

Operator: CATCHOPS YAZILIM SAN. VE TİC. LTD. ŞTİ. (Türkiye). Contact: support@ulagg.com, https://ulagg.com/contact

## Features

- **Listings:** an editor for title, description, tags, attributes, variations, images and video.
  Changes are drafted locally and sent to Etsy only when the seller clicks "Publish".
  The seller can also apply bulk edits to their own listings.
- **Orders:** an order list, shipping-deadline tracking, and adding tracking numbers (createReceiptShipment).
- **Profit:** per-order and per-product profit calculated from receipts, payments and ledger entries,
  plus the seller's own cost inputs.
- **Reviews and shop profile:** a read-only overview.
- **SEO help (optional):** AI suggestions for titles and tags. The seller can turn AI off for their workspace.
- **Languages:** the whole app is available in English and Turkish (English by default outside Turkey; a switch
  in the top bar changes it).

## OAuth scopes and why each is needed

| Scope | Used for |
|---|---|
| `listings_r` | Show the seller's listings, inventory and images |
| `listings_w` | Publish listing edits made by the seller, upload images and videos |
| `listings_d` | Delete a listing, only when the seller confirms it explicitly |
| `transactions_r` | Orders, payments and ledger entries for the profit reports |
| `transactions_w` | Add tracking information to orders |
| `shops_r` | Shop profile, sections and shipping profiles |
| `shops_w` | Create and edit shop sections and shipping profiles from the app |

We do **not** request access to `buyer_email`. Buyer e-mail addresses are not stored.

## Compliance with the API Terms of Use

- **Caching and freshness:** data is kept only to provide the service to the connected seller. Background refresh:
  orders every 2 hours (incremental, `min_last_modified`); listings, reviews, the shop profile and payment-account
  ledger entries every 4 hours (all incremental).
  A listing that is older than this is also refreshed when the seller opens it. Displayed data is therefore well
  inside the freshness window. Historical receipts and ledger entries are kept while the shop is connected,
  because the profit reports need them.
- **Disconnect and deletion:** when a seller disconnects the shop or deletes the account, the OAuth tokens and all
  cached Etsy data are deleted (listings, orders, reviews, ledger, payments, statistics, cached images).
- **Trademark:** the product name and logo do not use "Etsy". The required notice appears on the home page and in
  the footer of every public page: "The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API
  but is not endorsed or certified by Etsy, Inc."
- **No scraping:** all Etsy data comes through Open API v3.
- **Security:** OAuth tokens are encrypted at rest (Fernet). Data is stored in the EU (Supabase Postgres, EU region;
  API servers in Frankfurt), and each customer's data is isolated with workspace-level access control. Traffic uses HTTPS only.
- **AI:** when the seller uses AI features, the needed listing text is sent to the AI provider (OpenAI or
  Google Gemini) through their APIs, under terms that do not allow training on API data. Etsy data is not used to
  train models, is not sold, and is not used for advertising. See https://ulagg.com/ai-data.
- **Legal pages:** https://ulagg.com/privacy, https://ulagg.com/terms, https://ulagg.com/cookies,
  https://ulagg.com/kvkk

## Expected usage

These are estimates. They have not yet been measured with many shops.

- Shops in the first 12 months: 50–200
- First connection: about 1,000–1,500 requests per shop (one-time import of order history and ledger).
- Steady state: about 100–200 requests per shop per day (background refresh plus normal use).
- All requests go through one app-wide limiter (≤ 5 QPS) and a daily budget for background jobs, and 429 responses
  are retried later. We plan to move order updates to webhooks (`order.paid`, `order.shipped`, …) once they are
  available to the app, which will cut polling.

## Test access for the review

- Demo account: demo@ulagg.com / [password, entered only in the form]
  The demo shop is a copy of 20 listings and 20 orders from our own shop. Buyer names, addresses, messages,
  personalization text and tracking numbers are replaced with placeholders. The demo shop has no Etsy token,
  so nothing is sent to Etsy from this account; a banner in the app says so.
