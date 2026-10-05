import Link from "next/link";
import { H2, P, Table, UL } from "@/components/legal/LegalLayout";
import { BRAND, COMPANY, ETSY_DISCLAIMER } from "@/lib/legal";

export const TERMS_INTRO = `These terms govern your use of ${BRAND}, provided by ${COMPANY.name}. By creating an account or using the service you agree to them.`;

export function TermsEn() {
  return (
    <>
      <H2>1. The service</H2>
      <P>
        {BRAND} is software that helps Etsy sellers manage listings, orders, costs and profit, and prepare content. {BRAND} is
        not affiliated with Etsy, Inc. and is not endorsed or certified by Etsy.
      </P>
      <P>{ETSY_DISCLAIMER}</P>

      <H2>2. Your account</H2>
      <UL>
        <li>You must be at least 18 and give accurate information.</li>
        <li>You are responsible for your account&apos;s security. Tell us if you suspect unauthorized use.</li>
        <li>You may only connect an Etsy shop that you are authorized to manage.</li>
      </UL>

      <H2>3. Etsy connection</H2>
      <P>
        You connect your shop through Etsy&apos;s own authorization screen and can disconnect at any time. You remain responsible
        for using your Etsy account in line with Etsy&apos;s terms and API terms. If Etsy restricts or changes API access, some
        features may be affected.
      </P>

      <H2>4. Publishing and approval</H2>
      <P>
        Changes are only written to your shop after you approve them. You are responsible for reviewing content, including
        AI-generated content, before publishing. {BRAND} does not guarantee accuracy of results, sales or search ranking on Etsy.
      </P>

      <H2>5. Acceptable use</H2>
      <UL>
        <li>Do not use the service in violation of law, Etsy&apos;s policies or third-party rights.</li>
        <li>Do not upload or generate content that infringes copyright, trademark or personality rights, or use images you have no right to use.</li>
        <li>Do not reverse engineer the service, scrape it, or place excessive load on it.</li>
        <li>Do not share or resell your account.</li>
      </UL>

      <H2>6. AI content</H2>
      <P>
        You are responsible for AI-assisted text and images that you publish. Do not generate content that could infringe a
        brand or another person&apos;s work. See <Link className="underline" href="/ai-data">AI &amp; Data Use</Link>.
      </P>

      <H2>7. Fees</H2>
      <P>
        Free and paid plans may be offered. Prices, usage limits and AI credits are shown at purchase. Subscriptions renew until
        cancelled. Refund terms will be shown at checkout.
      </P>

      <H2>8. Your data</H2>
      <P>
        Your data belongs to you. You give us only the limited permission needed to run the service. Processing is described in
        the <Link className="underline" href="/privacy">Privacy Policy</Link>. You can delete your account at any time.
      </P>

      <H2>9. Availability</H2>
      <P>
        We aim for reliable service but do not guarantee uninterrupted or error-free operation. Maintenance, third-party
        outages and Etsy API limits can affect availability.
      </P>

      <H2>10. Limitation of liability</H2>
      <P>
        The service is provided &quot;as is&quot;. To the extent permitted by law we are not liable for indirect damages, lost
        profit, data loss or restrictions placed on your Etsy account. Our total liability is limited to the amount you paid us
        in the 12 months before the event. Mandatory consumer rights are unaffected.
      </P>

      <H2>11. Suspension and termination</H2>
      <P>
        We may suspend or close accounts that breach these terms. You may delete your account at any time. If we ever shut the
        service down we will give reasonable advance notice and time to export your data.
      </P>

      <H2>12. Changes</H2>
      <P>
        We may update these terms. For material changes we will notify you in advance and ask you to accept again where required.
      </P>

      <H2>13. Governing law</H2>
      <P>
        These terms are governed by the laws of the Republic of Türkiye. Courts at the location of {COMPANY.name} have
        jurisdiction, without prejudice to mandatory consumer protections that apply to you.
      </P>

      <H2>14. Contact</H2>
      <P>{COMPANY.email}</P>
    </>
  );
}

export const PRIVACY_INTRO = `${BRAND} is an operations and profit workspace for Etsy sellers. This policy explains what data we collect, why, and your rights. It applies to users in Türkiye (KVKK), the European Union (GDPR) and elsewhere.`;

export function PrivacyEn() {
  return (
    <>
      <H2>1. Who we are</H2>
      <P>
        The data controller is {COMPANY.name} ({COMPANY.address}). Contact: {COMPANY.email}. Users in Türkiye can read the{" "}
        <Link className="underline" href="/kvkk">KVKK notice</Link> (in Turkish).
      </P>

      <H2>2. Data we collect</H2>
      <UL>
        <li><b>Account:</b> email, name, profile photo from Google if you sign in with Google. Passwords are handled by our authentication provider and are never visible to us.</li>
        <li><b>Etsy data</b>, once you authorize it: shop details, listings, images, orders, reviews and performance statistics. Orders include buyer name and shipping address.</li>
        <li><b>What you enter:</b> product costs, drafts, notes, uploaded images, and messages (with any files you attach) sent through the contact form.</li>
        <li><b>Technical data:</b> IP address, browser, session and error logs.</li>
      </UL>
      <P>We never collect your Etsy password. The connection is made through Etsy&apos;s authorization screen (OAuth).</P>

      <H2>3. How we use it</H2>
      <UL>
        <li>To provide the service: show listings, orders and profit, and write changes to Etsy only after you approve them.</li>
        <li>Security, debugging and abuse prevention.</li>
        <li>Service messages and support.</li>
      </UL>
      <P>
        We do not use Etsy data to train AI models, sell it, build advertising profiles, or show it to anyone other than you
        and the members of your workspace.
      </P>

      <H2>4. AI features</H2>
      <P>
        When you use an AI feature, the relevant content (for example a listing title, description or image) is sent to the AI
        provider to produce a result. Details are in <Link className="underline" href="/ai-data">AI &amp; Data Use</Link>. AI
        output is never written to Etsy without your approval.
      </P>

      <H2>5. Sharing</H2>
      <P>We share data only with the infrastructure providers needed to run the service, and with authorities where required by law:</P>
      <Table
        head={["Provider", "Purpose", "Location"]}
        rows={[
          ["Etsy, Inc.", "Reading shop data and writing changes you approve", "USA"],
          ["Supabase", "Authentication, database, file storage", "EU"],
          ["Render", "Application servers and background jobs", "EU / USA"],
          ["Vercel", "Hosting of the web interface", "Global CDN"],
          ["Anthropic, OpenAI, Google", "AI text and image generation, only when you use an AI feature", "USA"],
          ["Payment provider (when paid plans launch)", "Subscriptions and invoices", "EU / USA"],
        ]}
      />

      <H2>6. International transfers</H2>
      <P>
        Some providers are outside the EU/EEA and Türkiye (for example in the USA). Transfers rely on legal safeguards such as
        standard contractual clauses or adequacy decisions.
      </P>

      <H2>7. Retention and deletion</H2>
      <P>
        We keep data for as long as needed to provide the service. When you disconnect Etsy, data received from Etsy is deleted;
        this includes assistant chats. Files attached to the assistant (images, PDF, Excel) are deleted automatically after 90
        days, and chats that are not opened for 12 months are deleted entirely. What the assistant &quot;remembers&quot; (lasting
        preferences you told it) is kept with your shop; you can view and delete it under Settings, AI. Assistant usage amounts
        (token counts) are kept for cost tracking while your account is open and contain no content.
        Contact form messages and their attachments are deleted automatically after 12 months. We keep your sign-up consent
        record (policy version, time, IP address) while your account is open, as legal proof. You can delete your account
        under Settings, Account and data; your personal data is then deleted or anonymized, except records we must keep by law.
      </P>

      <H2>8. Your rights</H2>
      <P>
        You can request access, correction, deletion, restriction, portability, and object to processing. If you live in the EU
        you can also complain to your local data protection authority. Requests: {COMPANY.kvkkEmail}.
      </P>

      <H2>9. Security</H2>
      <P>
        Etsy access tokens are stored encrypted, connections use HTTPS, and each customer&apos;s data is logically separated. No
        system is risk-free; in case of a data breach we will notify affected people, and Etsy where applicable, within the
        legally required time.
      </P>

      <H2>10. Children</H2>
      <P>The service is not intended for anyone under 18.</P>

      <H2>11. Changes</H2>
      <P>We may update this policy. We will tell you about material changes by email or in the app and ask for consent again where needed.</P>
    </>
  );
}

export const COOKIES_INTRO = `${BRAND} uses cookies and similar technologies (such as browser local storage) only to the extent needed. This page lists what we use and why.`;

export function CookiesEn() {
  return (
    <>
      <H2>What we use</H2>
      <Table
        head={["Name", "Type", "Purpose", "Duration"]}
        rows={[
          ["ulagg_at (cookie)", "Strictly necessary", "Sends your sign-in to the server for requests such as images, file downloads and connecting your Etsy shop", "Lifetime of the session token (about 1 hour, renewed automatically)"],
          ["sb-…-auth-token (local storage, Supabase)", "Strictly necessary", "Keeps you signed in with Google or email", "Until you sign out"],
          ["pendingConsent (local storage)", "Strictly necessary", "Records the consent you gave while signing up, at first login", "A few minutes (removed once used)"],
          ["ulagg_lang (cookie)", "Functional", "Remembers your language choice", "12 months"],
          ["theme (local storage)", "Functional", "Remembers light or dark mode", "Until you clear it"],
          ["ulagg_cookie_notice (local storage)", "Functional", "Remembers that you closed the cookie notice", "12 months"],
        ]}
      />

      <H2>Analytics and advertising</H2>
      <P>
        We currently use no analytics, advertising or marketing cookies. If that changes we will only enable them after you
        actively accept (no pre-ticked boxes) and update this page.
      </P>

      <H2>Legal basis</H2>
      <P>
        Strictly necessary cookies are required to provide the service and do not need consent. Functional items only store a
        choice you made and do not collect personal data.
      </P>

      <H2>Managing cookies</H2>
      <P>You can delete or block cookies in your browser settings. If you block strictly necessary cookies you will not be able to sign in.</P>

      <H2>Contact</H2>
      <P>{COMPANY.email}</P>
    </>
  );
}

export const AI_INTRO = `${BRAND} uses AI providers to generate text and images. This page explains what data goes where and how you stay in control.`;

export function AiDataEn() {
  return (
    <>
      <H2>Where AI is used</H2>
      <UL>
        <li>Title, tag and description suggestions.</li>
        <li>Product image generation and editing.</li>
        <li>A chat assistant that summarizes your shop data.</li>
      </UL>

      <H2>Providers and what is sent</H2>
      <Table
        head={["Provider", "Use", "Data sent"]}
        rows={[
          ["Anthropic", "Text generation, assistant", "The relevant listing text and attributes, and the shop summary the assistant needs to answer"],
          ["OpenAI / Google", "Image generation and editing", "The product image you select and the instruction you write"],
        ]}
      />
      <P>
        We aim not to send buyer names or shipping addresses to AI providers and do not include them in a request unless a feature
        strictly needs them.
      </P>

      <H2>Our commitments</H2>
      <UL>
        <li>We do not use Etsy data to train AI models, and we use provider API terms under which API data is not used for training.</li>
        <li>AI output is never written to your Etsy shop until you review and approve it.</li>
        <li>You can turn AI features off in Settings; while off, your content is not sent to AI providers.</li>
      </UL>

      <H2>Your responsibility</H2>
      <UL>
        <li>AI output can be wrong or incomplete. Check it before publishing.</li>
        <li>When you generate or edit images you confirm that you have the rights to the source image.</li>
        <li>Do not imitate another person&apos;s brand, character or artwork. Follow Etsy&apos;s policies.</li>
        <li>Etsy may require sellers to disclose AI use in some listings; that obligation is yours.</li>
      </UL>

      <H2>Records</H2>
      <P>
        We keep your generation history (original, generated image and model used) in your account so you can undo changes. You
        can remove these records by deleting your account.
      </P>

      <H2>Contact</H2>
      <P>{COMPANY.email}</P>
    </>
  );
}
