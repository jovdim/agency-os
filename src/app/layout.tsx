import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { DomErrorSilencer } from "@/components/dom-error-silencer";
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
  title: "GoWebify",
  description: "Websites for small businesses & entrepreneurs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking script — runs before paint to prevent layout flash when embedded in iframe */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(window.self!==window.top){document.documentElement.classList.add('is-embedded')}}catch(e){}` }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {/* Silently swallows the noisy "removeChild not a child of this
              node" / "insertBefore" errors from sonner-portal + React
              reconciliation races. Doesn't hide real bugs — only this
              specific harmless DOM-mutation signature. */}
          <DomErrorSilencer />
          {children}
          {/* position: top-center applies globally to every toast in the app
              (toast.success / toast.error / toast.info / toast.message). */}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
