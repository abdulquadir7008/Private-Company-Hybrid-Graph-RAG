// Lightweight fetch wrapper around the Graph RAG API. Auth token is injected
// from the caller (localStorage-backed AuthProvider).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  status: number;
  code?: string;
  field?: string;
  constructor(message: string, status: number, code?: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export interface FetchOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  form?: FormData;
}

export async function apiFetch<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let payload: BodyInit | undefined;
  if (opts.form) {
    payload = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: opts.method ?? "GET", headers, body: payload });
  } catch {
    throw new ApiError("Cannot reach the API server.", 0, "NETWORK");
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; field?: string };
  if (!res.ok) {
    throw new ApiError(data.error ?? res.statusText ?? "Request failed", res.status, data.code, data.field);
  }
  return data as T;
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}