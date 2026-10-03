// deploy/preview access control, checked without a Docker daemon:
//
// - The entrypoint guard is run for real (POSIX sh, and dash when present) with
//   a stand-in command: it must refuse to exec anything unless both
//   PREVIEW_AUTH_USER and a well-formed bcrypt PREVIEW_AUTH_HASH are set.
// - The Caddyfile reads the account only from the environment, leaves only
//   /healthz unauthenticated, and marks every response noindex.
// - Nothing under deploy/preview carries a credential, a hash, a host name or
//   a URL other than the container's own loopback.
//
// Caddy's own fail-closed behaviour (half-empty account line does not load;
// empty account list answers 401) is proven at deploy time by
// deploy/preview/fail-closed-check.sh against the built image.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PREVIEW = new URL("../../../deploy/preview/", import.meta.url);
const entrypoint = fileURLToPath(new URL("entrypoint.sh", PREVIEW));
const caddyfile = readFileSync(new URL("Caddyfile", PREVIEW), "utf8");

// A syntactically valid bcrypt string built here at run time (not a real
// credential; no hash literal is stored in the repository).
const WELL_FORMED_HASH = `$2a$14$${"A".repeat(53)}`;
const SHELLS = ["/bin/sh", "/bin/dash"].filter((shell) => existsSync(shell));

function runGuard(shell, env) {
  const result = spawnSync(shell, [entrypoint, "/bin/echo", "STARTED"], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.each(SHELLS)("preview entrypoint under %s", (shell) => {
  it("execs the server only with a user name and a bcrypt hash", () => {
    const ok = runGuard(shell, { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: WELL_FORMED_HASH });
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe("STARTED");
    for (const prefix of ["$2b$10$", "$2y$04$", "$2a$31$"]) {
      const variant = runGuard(shell, { PREVIEW_AUTH_USER: "p.v_1-x", PREVIEW_AUTH_HASH: `${prefix}${"./9z".repeat(13)}a` });
      expect(variant.status, prefix).toBe(0);
    }
  });

  it.each([
    ["nothing set", {}],
    ["user only", { PREVIEW_AUTH_USER: "preview" }],
    ["hash only", { PREVIEW_AUTH_HASH: WELL_FORMED_HASH }],
    ["empty user", { PREVIEW_AUTH_USER: "", PREVIEW_AUTH_HASH: WELL_FORMED_HASH }],
    ["empty hash", { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: "" }],
    ["plaintext password as hash", { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: "correct horse battery staple" }],
    ["truncated hash", { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: WELL_FORMED_HASH.slice(0, 59) }],
    ["unknown bcrypt prefix", { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: WELL_FORMED_HASH.replace("$2a$", "$2x$") }],
    ["cost out of range", { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: WELL_FORMED_HASH.replace("$14$", "$03$") }],
    ["hash with a newline", { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: `${WELL_FORMED_HASH.slice(0, 59)}\n` }],
    [
      "hash smuggling a Caddyfile line",
      { PREVIEW_AUTH_USER: "preview", PREVIEW_AUTH_HASH: `${WELL_FORMED_HASH}\n}\nrespond 200` },
    ],
    ["user with a space", { PREVIEW_AUTH_USER: "pre view", PREVIEW_AUTH_HASH: WELL_FORMED_HASH }],
    ["user with a brace", { PREVIEW_AUTH_USER: "preview}", PREVIEW_AUTH_HASH: WELL_FORMED_HASH }],
    ["user too long", { PREVIEW_AUTH_USER: "u".repeat(65), PREVIEW_AUTH_HASH: WELL_FORMED_HASH }],
  ])("refuses to start: %s", (_label, env) => {
    const result = runGuard(shell, env);
    expect(result.status).toBe(64);
    expect(result.stdout).not.toContain("STARTED");
    expect(result.stderr).toContain("refusing to start");
  });
});

describe("preview Caddyfile access control", () => {
  it("takes the only account from the environment", () => {
    const block = caddyfile.match(/basic_auth \{\n([^\n]*)\n\s*\}/);
    expect(block).not.toBeNull();
    expect(block[1].trim()).toBe("{$PREVIEW_AUTH_USER} {$PREVIEW_AUTH_HASH}");
    expect(caddyfile.match(/basic_auth/g)).toHaveLength(1);
    expect(caddyfile).not.toMatch(/basicauth/);
  });

  it("leaves only /healthz before the authentication", () => {
    const route = caddyfile.slice(caddyfile.indexOf("route {"));
    const beforeAuth = route.slice(0, route.indexOf("basic_auth"));
    const withoutHeaderBlock = beforeAuth.replace(/\n\t\theader \{[^}]*\}/, "\n\t\t<route headers>");
    const handlers = withoutHeaderBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "route {");
    expect(handlers).toEqual(["<route headers>", "@health path /healthz", 'respond @health "ok" 200']);
  });

  it("marks every response noindex, the 401 and /healthz included", () => {
    // A header block that deletes a field is deferred, and deferred operations do
    // not reach error responses (verified against Caddy 2.11.4: the 401 from
    // basic_auth lacked them). The deletion therefore stands alone outside the
    // route, and every added field is set immediately as the route's first handler.
    expect(caddyfile).toMatch(/\n\theader -Server\n/);
    const routeHeaders = caddyfile.match(/route \{\n(?:\t\t#[^\n]*\n)*\t\theader \{([^}]*)\}/);
    expect(routeHeaders).not.toBeNull();
    expect(routeHeaders[1]).not.toMatch(/^\s*-/m);
    expect(routeHeaders[1]).toContain('Cache-Control "no-store"');
    expect(routeHeaders[1]).toContain('X-Robots-Tag "noindex, nofollow"');
    expect(routeHeaders[1]).toContain("Content-Security-Policy");
    expect(caddyfile.indexOf("X-Robots-Tag")).toBeLessThan(caddyfile.indexOf("basic_auth"));
  });

  it("does not serve the research study and caches nothing publicly", () => {
    expect(caddyfile).toMatch(/@study path \/study \/study\/\* \/research \/research\/\* \/index\.html \/study-sw\.js/);
    expect(caddyfile).toContain("respond @study 404");
    expect(caddyfile).not.toMatch(/Cache-Control "public/);
  });
});

describe("deploy/preview carries no secrets, hosts or URLs", () => {
  const files = readdirSync(PREVIEW).map((name) => ({ name, text: readFileSync(new URL(name, PREVIEW), "utf8") }));

  it.each(files)("$name", ({ text }) => {
    expect(text).not.toMatch(/\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/);
    expect(text).not.toMatch(/PREVIEW_SMOKE_PASSWORD=[^<\s"'$]/);
    expect(text).not.toMatch(/panshi\.app|\.local\b|\.internal\b/);
    for (const url of text.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`)]+/gi) ?? []) {
      expect(url, url).toMatch(/^http:\/\/127\.0\.0\.1:(8080\/|\$port$)/);
    }
  });
});
