import dns from "dns";
import http from "http";
import https from "https";

// SSRF blocked IP ranges per Section 4.3 of the Master Engineering Specification
// 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.169.254/32, ::1, fc00::/7, fe80::/10

export class SSRFBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFBlockedError";
  }
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to private, loopback, link-local,
 * or cloud metadata ranges.
 */
export function isPrivateOrBlockedIP(ip: string, allowLoopback = false): boolean {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const ipv4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const targetIp = ipv4Mapped ? ipv4Mapped[1] : ip;

  if (allowLoopback && (targetIp === "127.0.0.1" || targetIp === "::1")) {
    return false;
  }

  // Check IPv4
  if (targetIp.includes(".")) {
    const parts = targetIp.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true; // Malformed IPv4 is blocked
    }

    const [a, b] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 10.0.0.0/8 (Private)
    if (a === 10) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 169.254.0.0/16 (Link-local & AWS/GCP cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true;

    return false;
  }

  // Check IPv6
  const lowerIp = targetIp.toLowerCase();

  // Loopback (::1) and Unspecified (::)
  if (lowerIp === "::1" || lowerIp === "::" || lowerIp === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // Unique local addresses (fc00::/7 -> fc00:: to fdff::)
  if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) {
    return true;
  }

  // Link-local addresses (fe80::/10 -> fe80:: to febf::)
  if (
    lowerIp.startsWith("fe8") ||
    lowerIp.startsWith("fe9") ||
    lowerIp.startsWith("fea") ||
    lowerIp.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

/**
 * Validates a destination URL against SSRF rules:
 * 1. Scheme must be http: or https:
 * 2. Hostname must resolve strictly to non-private, non-metadata IP addresses.
 */
export async function validateOutboundUrl(
  targetUrl: string,
  allowLoopback = false
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new SSRFBlockedError(`Invalid URL format: ${targetUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFBlockedError(
      `Forbidden URL protocol: ${parsed.protocol}. Only http: and https: are permitted.`
    );
  }

  const hostname = parsed.hostname;

  if (allowLoopback && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return targetUrl;
  }

  // Direct IP check
  if (isPrivateOrBlockedIP(hostname, allowLoopback)) {
    throw new SSRFBlockedError(`SSRF Blocked: IP address ${hostname} is private or restricted`);
  }

  // DNS resolution check
  const addresses = await dns.promises.lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new SSRFBlockedError(`Could not resolve hostname: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateOrBlockedIP(addr.address, allowLoopback)) {
      throw new SSRFBlockedError(
        `SSRF Blocked: Destination ${hostname} resolved to restricted IP ${addr.address}`
      );
    }
  }

  return targetUrl;
}

/**
 * Custom lookup function for Node HTTP(S) agents that validates the resolved IP
 * at socket connect time, defeating DNS rebinding attacks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ssrfSafeLookup: any = (
  hostname: string,
  options: any,
  callback: any
): void => {
  dns.lookup(hostname, options, (err: NodeJS.ErrnoException | null, address: any, family: any) => {
    if (err) {
      return callback(err);
    }

    if (Array.isArray(address)) {
      for (const item of address) {
        if (isPrivateOrBlockedIP(item.address)) {
          return callback(
            new SSRFBlockedError(`SSRF Blocked: Connection to restricted IP ${item.address}`)
          );
        }
      }
      return callback(null, address, family);
    }

    if (typeof address === "string" && isPrivateOrBlockedIP(address)) {
      return callback(
        new SSRFBlockedError(`SSRF Blocked: Connection to restricted IP ${address}`)
      );
    }

    callback(null, address, family);
  });
};

// Pre-configured SSRF-safe HTTP and HTTPS agents
export const ssrfSafeHttpAgent = new http.Agent({
  lookup: ssrfSafeLookup,
  keepAlive: true,
  timeout: 5000,
});

export const ssrfSafeHttpsAgent = new https.Agent({
  lookup: ssrfSafeLookup,
  keepAlive: true,
  timeout: 5000,
});
