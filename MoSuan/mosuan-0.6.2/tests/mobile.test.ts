import { describe, expect, it } from 'vitest';
import { normalizeServer, saveMobileConnection, mobileConnection, disconnectMobile, mobileMode, saveMobileMode } from '../src/lib/mobile';
describe('Android server configuration', () => {
  it('accepts local network endpoints and requires HTTPS elsewhere', () => {
    expect(normalizeServer(' http://192.168.1.12:3001/ ')).toBe('http://192.168.1.12:3001');
    expect(normalizeServer('http://10.0.2.2:3001')).toContain('10.0.2.2');
    expect(normalizeServer('https://reader.example.com')).toContain('https:');
    for (const value of ['javascript:alert(1)', 'http://example.com', 'http://user:pass@192.168.1.1', 'http://192.168.1.1/api', 'http://192.168.1.1?token=x']) expect(() => normalizeServer(value)).toThrow();
  });
  it('persists and removes only the mobile connection configuration', () => {
    const token = 'a'.repeat(48);
    saveMobileConnection('http://192.168.1.10:3001', token);
    expect(mobileConnection()).toEqual({ url: 'http://192.168.1.10:3001', token });
    expect(() => saveMobileConnection('http://192.168.1.10:3001', 'bad')).toThrow();
    disconnectMobile(); expect(mobileConnection()).toBeNull();
  });
  it('defaults new installs to phone web and keeps paired installations on their prior transport', () => {
    localStorage.clear(); expect(mobileMode()).toBe('phone-web');
    localStorage.setItem('mosuan-mobile-server-v1', JSON.stringify({ url: 'http://192.168.1.10:3001', token: 'a'.repeat(48) }));
    expect(mobileMode()).toBe('computer');
    saveMobileMode('phone-web'); expect(mobileMode()).toBe('phone-web'); expect(mobileConnection()).not.toBeNull();
  });
});
