import { execFile } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
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

async function resolveHostViaDoh(hostname: string): Promise<string[]> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (ShanghaiDecisionBot)' }
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { Answer?: Array<{ type?: number; data?: string }> };
    return Array.from(new Set((json.Answer ?? []).filter((a) => a.type === 1 && typeof a.data === 'string').map((a) => a.data as string)));
  } catch {
    return [];
  }
}

async function resolveHostViaDohCurl(hostname: string): Promise<string[]> {
  const providers = [
    {
      host: 'dns.google',
      ip: '8.8.8.8',
      url: `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
      accept: 'application/json'
    },
    {
      host: 'cloudflare-dns.com',
      ip: '1.1.1.1',
      url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      accept: 'application/dns-json'
    },
    {
      host: 'dns.alidns.com',
      ip: '223.5.5.5',
      url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(hostname)}&type=A`,
      accept: 'application/json'
    }
  ] as const;

  const ips: string[] = [];
  for (const env of [process.env, noProxyEnv]) {
    for (const p of providers) {
      try {
        const { stdout } = await execFileAsync(
          'curl',
          [
            '-sS',
            '-L',
            '--max-time',
            '8',
            '--resolve',
            `${p.host}:443:${p.ip}`,
            '-H',
            `Accept: ${p.accept}`,
            p.url
          ],
          { maxBuffer: 1024 * 1024, env }
        );
        const json = JSON.parse(stdout) as { Answer?: Array<{ type?: number; data?: string }> };
        for (const ans of json.Answer ?? []) {
          if (ans.type === 1 && typeof ans.data === 'string') ips.push(ans.data);
        }
      } catch {
        // try next provider
      }
    }
  }
  return Array.from(new Set(ips));
}

async function resolveHostViaPublicDns(hostname: string): Promise<string[]> {
  const servers = [
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['223.5.5.5']
  ];
  const ips: string[] = [];
  for (const s of servers) {
    try {
      const r = new Resolver();
      r.setServers(s);
      const resolved = await r.resolve4(hostname);
      if (resolved.length) {
        for (const ip of resolved) ips.push(ip);
      }
    } catch {
      // try next resolver
    }
  }
  return Array.from(new Set(ips));
}

async function resolveCandidateIps(host: string) {
  const direct = await resolveHostViaPublicDns(host);
  const dohCurl = await resolveHostViaDohCurl(host);
  const doh = await resolveHostViaDoh(host);
  return Array.from(new Set([...direct, ...dohCurl, ...doh]));
}

async function tryCurlJson(url: string, timeoutMs: number, env: NodeJS.ProcessEnv, resolveIp?: string) {
  const args = ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Accept: application/json'];
  if (resolveIp) {
    const host = new URL(url).hostname;
    args.push('--resolve', `${host}:443:${resolveIp}`);
  }
  args.push(url);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 5 * 1024 * 1024, env });
  return JSON.parse(stdout);
}

async function tryCurlText(url: string, timeoutMs: number, env: NodeJS.ProcessEnv, resolveIp?: string) {
  const args = ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', 'Accept: text/html'];
  if (resolveIp) {
    const host = new URL(url).hostname;
    args.push('--resolve', `${host}:443:${resolveIp}`);
  }
  args.push(url);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 8 * 1024 * 1024, env });
  return stdout;
}

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
      return await tryCurlJson(url, timeoutMs, process.env);
    } catch {
      try {
        return await tryCurlJson(url, timeoutMs, noProxyEnv);
      } catch (curlErr) {
        const host = new URL(url).hostname;
        const ips = await resolveCandidateIps(host);
        if (!ips.length) throw curlErr;
        let lastErr: unknown = curlErr;
        for (const ip of ips) {
          try {
            return await tryCurlJson(url, timeoutMs, process.env, ip);
          } catch (e) {
            lastErr = e;
          }
          try {
            return await tryCurlJson(url, timeoutMs, noProxyEnv, ip);
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      }
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

    try {
      return await tryCurlText(url, timeoutMs, process.env);
    } catch {
      try {
        return await tryCurlText(url, timeoutMs, noProxyEnv);
      } catch (curlErr) {
        const host = new URL(url).hostname;
        const ips = await resolveCandidateIps(host);
        if (!ips.length) throw curlErr;
        let lastErr: unknown = curlErr;
        for (const ip of ips) {
          try {
            return await tryCurlText(url, timeoutMs, process.env, ip);
          } catch (e) {
            lastErr = e;
          }
          try {
            return await tryCurlText(url, timeoutMs, noProxyEnv, ip);
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      }
    }
  }
}

export async function fetchTextWithCurlOnly(url: string, timeoutMs = 12000) {
  try {
    return await tryCurlText(url, timeoutMs, process.env);
  } catch {
    try {
      return await tryCurlText(url, timeoutMs, noProxyEnv);
    } catch (curlErr) {
      const host = new URL(url).hostname;
      const ips = await resolveCandidateIps(host);
      if (!ips.length) throw curlErr;
      let lastErr: unknown = curlErr;
      for (const ip of ips) {
        try {
          return await tryCurlText(url, timeoutMs, noProxyEnv, ip);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    }
  }
}
