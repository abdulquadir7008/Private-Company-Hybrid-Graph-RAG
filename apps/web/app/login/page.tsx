"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await login(email, password);
      router.replace("/chat");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (msg.includes("verify")) setNotice(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back to your Graph RAG workspace">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="rose">{error}</Alert>}
        {notice && <Alert tone="amber">{notice}</Alert>}
        {notice?.includes("verify") && (
          <Link href="/verify" className="block text-center text-xs text-indigo-400 hover:underline">
            Go to email verification →
          </Link>
        )}
        <div>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        </div>
        <div>
          <Label>Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <div className="flex justify-between pt-1 text-xs">
          <Link href="/forgot-password" className="text-indigo-400 hover:underline">
            Forgot password?
          </Link>
          <Link href="/register" className="text-slate-400 hover:text-slate-200">
            Create account
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}