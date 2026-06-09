// Egress URL guards for the provider abstraction.
//
// SECURITY (Story 8.1 code review, CRITICAL): a provider's `baseUrl` is the
// host the user's API key + prompt + file contents are POSTed to. Without
// validation, any code path that can set `baseUrl` (a persisted config, a
// poisoned imported project, a future cloud-sync) could redirect that send to
// an attacker-controlled host. These guards constrain `baseUrl` at
// `configure()` time so a bad value throws BEFORE any request is built.
//
//   - Cloud BYOK providers (OpenAI / Anthropic / OpenRouter) are PINNED to
//     their single documented vendor origin. The setup UI never offers a
//     base-URL field for them (UX-delta §4.2), so a non-vendor host is always
//     illegitimate.
//   - Ollama legitimately needs a custom host (the user runs their own
//     server), but only on the local machine or LAN — never a public host.
//     We allow loopback + RFC-1918 private ranges and REJECT public hosts and
//     link-local 169.254/16 (the cloud-metadata range) to block SSRF.

/**
 * Thrown by the egress guards on a disallowed `baseUrl`. A distinct class so
 * the studio can surface a clear "that endpoint isn't allowed" message rather
 * than a generic provider error.
 */
export class EgressBlockedError extends Error {
    /**
     * @param {string} message
     * @param {string} attemptedUrl
     */
    constructor(message, attemptedUrl) {
        super(message);
        this.name = 'EgressBlockedError';
        this.attemptedUrl = attemptedUrl;
    }
}

/**
 * Parse a candidate base URL, throwing `EgressBlockedError` if it is not a
 * syntactically valid absolute http(s) URL.
 *
 * @param {string} baseUrl
 * @returns {URL}
 */
function parseHttpUrl(baseUrl) {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
        throw new EgressBlockedError('baseUrl must be a non-empty string', String(baseUrl));
    }
    let u;
    try {
        u = new URL(baseUrl);
    } catch {
        throw new EgressBlockedError(`baseUrl is not a valid URL: '${baseUrl}'`, baseUrl);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new EgressBlockedError(
            `baseUrl scheme must be http(s); got '${u.protocol}'`,
            baseUrl,
        );
    }
    return u;
}

/**
 * Assert that a cloud provider's `baseUrl` exactly matches its pinned vendor
 * origin (scheme + host + port). Throws `EgressBlockedError` otherwise.
 *
 * @param {string} baseUrl       Candidate base URL.
 * @param {string} vendorOrigin  The pinned origin, e.g. 'https://api.openai.com'.
 * @returns {string} The normalized origin (no trailing slash) when allowed.
 */
export function assertVendorOrigin(baseUrl, vendorOrigin) {
    const u = parseHttpUrl(baseUrl);
    const vendor = new URL(vendorOrigin);
    // Require https for cloud vendors (all three documented hosts are https).
    if (u.protocol !== 'https:') {
        throw new EgressBlockedError(
            `cloud provider baseUrl must use https; got '${u.protocol}'`,
            baseUrl,
        );
    }
    if (u.host !== vendor.host) {
        throw new EgressBlockedError(
            `cloud provider baseUrl host '${u.host}' is not the pinned vendor host '${vendor.host}'; ` +
                `custom endpoints are not supported for BYOK cloud providers`,
            baseUrl,
        );
    }
    return u.origin;
}

/**
 * Assert that an Ollama `baseUrl` points at a local / private-network host.
 * Allows loopback + RFC-1918 private ranges; rejects public hosts, the
 * 169.254/16 link-local (cloud-metadata) range, and non-http(s) schemes.
 *
 * @param {string} baseUrl
 * @returns {string} The normalized origin when allowed.
 */
export function assertLocalOrigin(baseUrl) {
    const u = parseHttpUrl(baseUrl);
    // WHATWG URL keeps the brackets on an IPv6 hostname (e.g. '[::1]'); strip
    // them so the comparison below works.
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Named loopback.
    if (host === 'localhost' || host === 'localhost.localdomain') return u.origin;
    // IPv6 loopback.
    if (host === '::1') return u.origin;

    // IPv4 — classify by octets.
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (m) {
        const o = m.slice(1).map(Number);
        if (o.some((n) => n > 255)) {
            throw new EgressBlockedError(`invalid IPv4 host '${host}'`, baseUrl);
        }
        const [a, b] = o;
        const isLoopback = a === 127; // 127.0.0.0/8
        const isPrivateA = a === 10; // 10.0.0.0/8
        const isPrivateB = a === 172 && b >= 16 && b <= 31; // 172.16.0.0/12
        const isPrivateC = a === 192 && b === 168; // 192.168.0.0/16
        if (isLoopback || isPrivateA || isPrivateB || isPrivateC) return u.origin;
        // Everything else — public IPs AND 169.254/16 link-local
        // (cloud-metadata) — is rejected.
        throw new EgressBlockedError(
            `Ollama baseUrl host '${host}' is not a loopback or private-network address; ` +
                `Ollama must run on your local machine or LAN`,
            baseUrl,
        );
    }

    // A non-IP, non-localhost hostname (e.g. 'evil.example' or a *.local mDNS
    // name). Reject public DNS names; allow the conventional '.local' mDNS
    // suffix used by some LAN setups.
    if (host.endsWith('.local')) return u.origin;
    throw new EgressBlockedError(
        `Ollama baseUrl host '${host}' is not a recognized local/private host; ` +
            `use localhost, a 127.x / 10.x / 172.16-31.x / 192.168.x address, or a *.local name`,
        baseUrl,
    );
}
