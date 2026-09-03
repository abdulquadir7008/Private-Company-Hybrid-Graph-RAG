"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
import PageSeo from "@/components/PageSeo";
import { Alert, Button, Input, Label } from "@/components/ui";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/auth/register", { method: "POST", body: { name, email, password, companyName } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell title="Check your email" subtitle="We sent you a verification code">
        <Alert tone="green">Your account was created. Enter the 6-digit code from the email to verify your address.</Alert>
        <Link
          href={`/verify?email=${encodeURIComponent(email)}`}
          className="mt-4 block rounded-lg bg-indigo-600 px-3.5 py-2 text-center text-sm font-medium text-white hover:bg-indigo-500"
        >
          Enter verification code
        </Link>
      </AuthShell>
    );
  }

  return (
    <>
      <PageSeo title="Create Account" description="Create a secure Graph RAG knowledge workspace for your organization. Your company gets an isolated, private knowledge graph." keywords={["register", "sign up", "create account", "Graph RAG workspace"]} />
      <AuthShell title="Create account" subtitle="Start your secure Graph RAG workspace">
      <form onSubmit={onSubmit} className="auth-form space-y-4">
        {error && <Alert tone="rose">{error}</Alert>}
        <div>
          <Label>Full name</Label>
          <Input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
        </div>
        <div>
          <Label>Work email</Label>
          <Input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        </div>
        <div>
          <Label>Company name</Label>
          <Input className="auth-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company" required />
        </div>
        <div>
          <Label>Password (8+ characters)</Label>
          <Input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} placeholder="Create a password" required />
        </div>
        <Button type="submit" disabled={busy} className="auth-submit w-full text-[17px]">
          {busy ? "Creating…" : <>Create workspace <span className="ml-auto text-3xl font-light leading-none">→</span></>}
        </Button>
      </form>
    </AuthShell>
    </>
  );
}
