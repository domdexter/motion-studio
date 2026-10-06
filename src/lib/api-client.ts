"use client";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  hint?: string;
  action?: { label: string; href: string };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly hint?: string;
  readonly action?: { label: string; href: string };

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.details = body.details;
    this.hint = body.hint;
    this.action = body.action;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null };

export async function apiFetch<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  const res = await fetch(url, { ...options, headers, body, cache: "no-store" });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: ApiErrorBody } | null)?.error ?? { code: "HTTP_" + res.status, message: res.statusText || "Request failed" };
    throw new ApiError(err, res.status);
  }
  return data as T;
}

export const http = {
  get: <T>(url: string) => apiFetch<T>(url),
  post: <T>(url: string, json?: unknown) => apiFetch<T>(url, { method: "POST", json: json ?? {} }),
  patch: <T>(url: string, json: unknown) => apiFetch<T>(url, { method: "PATCH", json }),
  put: <T>(url: string, json: unknown) => apiFetch<T>(url, { method: "PUT", json }),
  delete: <T>(url: string, json?: unknown) => apiFetch<T>(url, { method: "DELETE", ...(json !== undefined ? { json } : {}) }),
};

/** multipart upload with progress (XHR — fetch has no upload progress). */
export function uploadForm<T>(url: string, form: FormData, onProgress?: (fraction: number) => void, signal?: AbortSignal, method: "POST" | "PUT" = "POST"): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError((data as { error?: ApiErrorBody } | null)?.error ?? { code: "HTTP_" + xhr.status, message: xhr.statusText || "Upload failed" }, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError({ code: "NETWORK", message: "Upload failed (network error)." }, 0));
    xhr.onabort = () => reject(new ApiError({ code: "ABORTED", message: "Upload cancelled." }, 0));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
