import { API_BASE } from '../config';

// Authed JSON fetch against the FastAPI backend. Throws on !ok with the server's `detail`
// (err.status / err.data carry the HTTP status + parsed body for callers that need them).
export async function apiFetch(path, { token, method = 'GET', body, ...rest } = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    ...rest,
  });

  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!resp.ok) {
    const detail = (data && data.detail) || `Request failed (${resp.status})`;
    const err = new Error(detail);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}
