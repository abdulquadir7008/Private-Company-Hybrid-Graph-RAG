"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";
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
    <AuthShell title="Create your workspace" subtitle="Your company gets an isolated knowledge graph">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="rose">{error}</Alert>}
        <div>
          <Label>Full name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label>Work email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label>Company name</Label>
          <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
        </div>
        <div>
          <Label>Password (8+ characters)</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create workspace"}
        </Button>
        <div className="pt-1 text-center text-xs">
          <span className="text-slate-500">Already have an account? </span>
          <Link href="/login" className="text-indigo-400 hover:underline">
            Sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}