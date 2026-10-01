import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { InlineScript } from "@/components/InlineScript";
import CookieNotice from "@/components/legal/CookieNotice";
import Toaster from "@/components/ui/Toaster";
import { BRAND } from "@/lib/legal";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: BRAND,
  description: "Etsy satıcıları için AI destekli operasyon ve kârlılık platformu",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved theme before first paint so there's no light->dark flash. */}
        <InlineScript
          html={`(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.add(t);}catch(e){}})();`}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <CookieNotice />
        <Toaster />
      </body>
    </html>
  );
}
