import { describe, expect, it } from 'vitest';
import { downloadFile, fetchApi, setAuthToken } from '@/lib/api';
import { captureDownloads, mockApi, stubLocation } from './helpers';

describe('API client', () => {
  it('sends the token as a Bearer header', async () => {
    setAuthToken('abc');
    const fetchMock = mockApi({ 'GET /parties': { body: [] } });
    await fetchApi('/parties');
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('an expired session logs out and goes to /login', async () => {
    setAuthToken('expired');
    const loc = stubLocation();
    mockApi({ 'GET /parties': { status: 401 } });
    await fetchApi('/parties');
    expect(localStorage.getItem('voicekhata_token')).toBeNull();
    expect(loc.href).toBe('/login');
  });

  it('a wrong password (401 on /auth/login) does NOT reload the page — regression', async () => {
    const loc = stubLocation();
    mockApi({ 'POST /auth/login': { status: 401, body: { error: 'Invalid password' } } });
    const res = await fetchApi('/auth/login', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(loc.href).toBe('http://localhost/dashboard');
  });

  it('downloads protected files with the token', async () => {
    setAuthToken('abc');
    const saved = captureDownloads();
    const fetchMock = mockApi({ 'GET /parties/p1/khata.pdf': { raw: '%PDF-1.7' } });
    await downloadFile('/parties/p1/khata.pdf', 'Khata_X.pdf');
    expect(saved).toEqual(['Khata_X.pdf']);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('shows the server\'s error message when a download fails', async () => {
    mockApi({ 'GET /export/x.csv': { status: 400, body: { error: 'Use ?from=YYYY-MM-DD' } } });
    await expect(downloadFile('/export/x.csv', 'x.csv')).rejects.toThrow('Use ?from=YYYY-MM-DD');
  });
});
