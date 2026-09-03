"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { login, loginWithToken, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (loading) return;
    const googleToken = searchParams.get("google_token");
    const googleError = searchParams.get("google_error");
    if (googleToken) {
      (async () => {
        setGoogleBusy(true);
        try {
          await loginWithToken(googleToken);
          router.replace("/chat");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Google sign-in failed");
        } finally {
          setGoogleBusy(false);
        }
      })();
    } else if (googleError) {
      setError("Google sign-in failed. Please try again.");
      router.replace("/login", { scroll: false });
    }
  }, [loading, searchParams, loginWithToken, router]);

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

  function startGoogle() {
    setError(null);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
    window.location.href = `${base}/auth/google?redirect=${encodeURIComponent(origin)}`;
  }

  return (
    <AuthShell title="Sign in" subtitle="Access your Graph RAG workspace">
      <form onSubmit={onSubmit} className="auth-form space-y-4">
        {error && <Alert tone="rose">{error}</Alert>}
        {notice && <Alert tone="amber">{notice}</Alert>}
        {notice?.includes("verify") && (
          <Link href="/verify" className="block text-center text-xs text-indigo-400 hover:underline">
            Go to email verification →
          </Link>
        )}
        <div>
          <Label>Email address</Label>
          <Input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        </div>
        <div>
          <Label>Password</Label>
          <Input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>
        <div className="flex items-center justify-between pt-1 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-slate-600"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-rose-500" />Remember me</label>
          <Link href="/forgot-password" className="font-medium text-rose-500 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" disabled={busy || googleBusy} className="auth-submit w-full text-[17px]">
          {busy ? "Signing in…" : <>Sign in <span className="ml-auto text-3xl font-light leading-none">→</span></>}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-sm text-slate-500">
        <span className="h-px flex-1 bg-rose-100" />
        or continue with
        <span className="h-px flex-1 bg-rose-100" />
      </div>

      <Button type="button" variant="outline" onClick={startGoogle} disabled={googleBusy} className="auth-google w-full text-[16px]">
        {googleBusy ? "Redirecting to Google…" : <><span className="text-xl font-bold text-[#4285F4]">G</span> Sign in with Google</>}
      </Button>
      <div className="mt-5 text-center text-sm text-slate-500">Don’t have an account? <Link href="/register" className="font-medium text-rose-500 hover:underline">Create account</Link></div>
    </AuthShell>
  );
}
