"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Spinner } from "@/components/ui";

export default function HomePage() {
  const { loading, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(token ? "/chat" : "/login");
  }, [loading, token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Spinner label="Loading…" />
    </main>
  );
}