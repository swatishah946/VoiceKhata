export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export function getAuthToken() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('voicekhata_token');
  }
  return null;
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const token = getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401) {
    // Clear token and redirect to login if unauthorized
    if (typeof window !== 'undefined') {
      localStorage.removeItem('voicekhata_token');
      window.location.href = '/login';
    }
  }

  return response;
}
