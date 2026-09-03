import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ToastProvider } from "@/components/Toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Graph RAG Assistant — Private Company Hybrid Graph RAG",
    template: "%s | Graph RAG Assistant"
  },
  description:
    "Secure private-company hybrid Graph RAG assistant. Ask questions across your knowledge graph, browse entities and documents, and get explainable, grounded answers with citations.",
  keywords: [
    "Graph RAG",
    "knowledge graph",
    "private AI assistant",
    "retrieval augmented generation",
    "hybrid RAG",
    "enterprise search",
    "entity graph",
    "document intelligence"
  ],
  applicationName: "Graph RAG Assistant",
  category: "Technology",
  metadataBase: new URL("https://graphrag.example.com"),
  openGraph: {
    type: "website",
    siteName: "Graph RAG Assistant",
    title: "Graph RAG Assistant — Private Company Hybrid Graph RAG",
    description:
      "Secure private-company hybrid Graph RAG assistant with explainable, grounded answers across your knowledge graph.",
    locale: "en_US"
  },
  twitter: {
    card: "summary",
    site: "@graphrag",
    title: "Graph RAG Assistant — Private Company Hybrid Graph RAG",
    description: "Explainable, grounded answers from your private company knowledge graph."
  },
  robots: {
    index: false,
    follow: true
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}