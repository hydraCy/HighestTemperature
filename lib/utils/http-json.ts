import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const noProxyEnv = {
  ...process.env,
  http_proxy: '',
  https_proxy: '',
  all_proxy: '',
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  ALL_PROXY: ''
};

export async function fetchJsonWithCurlFallback(url: string, timeoutMs = 12000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (ShanghaiDecisionBot)'
      }
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const shouldUseCurl =
      msg.includes('ENOTFOUND') ||
      msg.includes('fetch failed') ||
      msg.includes('getaddrinfo') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('network');

    if (!shouldUseCurl) throw error;

    try {
      const { stdout } = await execFileAsync(
        'curl',
        ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Accept: application/json', url],
        { maxBuffer: 5 * 1024 * 1024, env: process.env }
      );
      return JSON.parse(stdout);
    } catch {
      const { stdout } = await execFileAsync(
        'curl',
        ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Accept: application/json', url],
        { maxBuffer: 5 * 1024 * 1024, env: noProxyEnv }
      );
      return JSON.parse(stdout);
    }
  }
}

export async function fetchTextWithCurlFallback(url: string, timeoutMs = 12000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (ShanghaiDecisionBot)'
      }
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const shouldUseCurl =
      msg.includes('ENOTFOUND') ||
      msg.includes('fetch failed') ||
      msg.includes('getaddrinfo') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('network');

    if (!shouldUseCurl) throw error;

    const { stdout } = await execFileAsync(
      'curl',
      ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Accept: text/html', url],
      { maxBuffer: 8 * 1024 * 1024, env: noProxyEnv }
    );
    return stdout;
  }
}

export async function fetchTextWithCurlOnly(url: string, timeoutMs = 12000) {
  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Accept: text/html', url],
      { maxBuffer: 8 * 1024 * 1024, env: process.env }
    );
    return stdout;
  } catch {
    const { stdout } = await execFileAsync(
      'curl',
      ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Accept: text/html', url],
      { maxBuffer: 8 * 1024 * 1024, env: noProxyEnv }
    );
    return stdout;
  }
}
