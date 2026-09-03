"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import PageSeo from "@/components/PageSeo";
import { Spinner } from "@/components/ui";

export default function HomePage() {
  const { loading, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(token ? "/chat" : "/login");
  }, [loading, token, router]);

  return (
    <>
      <PageSeo title="Home" description="Private company hybrid Graph RAG assistant — explore your knowledge graph securely." keywords={["Graph RAG", "home", "dashboard"]} />
      <main className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading…" />
      </main>
    </>
  );
}