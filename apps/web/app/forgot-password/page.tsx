"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import PageSeo from "@/components/PageSeo";
import { Alert, Button, Input, Label } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/auth/forgot-password", { method: "POST", body: { email } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageSeo title="Forgot Password" description="Reset your password for your Graph RAG knowledge graph workspace account." keywords={["forgot password", "reset password", "account recovery"]} />
      <AuthShell title="Reset your password" subtitle="We will email you a secure reset link if the account exists">
      {done ? (
        <Alert tone="green">If that email exists, a reset link has been sent. Check your inbox.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="rose">{error}</Alert>}
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <div className="text-center text-xs">
            <Link href="/login" className="text-indigo-400 hover:underline">
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </AuthShell>
    </>
  );
}