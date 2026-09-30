export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';
const TOKEN_KEY = 'voicekhata_token';

export function getAuthToken() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(TOKEN_KEY);
  }
  return null;
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Expired/invalid session → back to login. Not for the login call itself:
  // a wrong password also returns 401, and redirecting there reloaded the page
  // so the "Invalid password" message was never shown.
  if (response.status === 401 && !endpoint.startsWith('/auth/')) {
    if (typeof window !== 'undefined') {
      clearAuthToken();
      window.location.href = '/login';
    }
  }

  return response;
}

/**
 * Downloads a protected file (khata PDF, CSV). A plain <a href> can't send the
 * Authorization header, so fetch it with the token and save the blob.
 */
export async function downloadFile(endpoint: string, filename: string): Promise<void> {
  const res = await fetchApi(endpoint);
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
