import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import * as oidc from "openid-client";
import { db, migrate } from "../../packages/platform/db.js";
import { start } from "../../packages/platform/http.js";
import { appVersion } from "../../packages/platform/version.js";
const origin = process.env.WEB_ORIGIN!;
const issuer = process.env.OIDC_ISSUER!;
const internal = process.env.OIDC_INTERNAL!;
const key = Buffer.from(process.env.SESSION_KEY!, "hex");
if (key.length !== 32) throw new Error("SESSION_KEY must be 32 bytes");
if (
  new URL(origin).protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
)
  throw new Error("HTTP only permitted on loopback development origin");
const cookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: origin.startsWith("https:"),
  path: "/",
};
type Session = {
  kind: "pending" | "user";
  state?: string;
  nonce?: string;
  verifier?: string;
  accessToken?: string;
  idToken?: string;
  csrf?: string;
  user?: unknown;
  context?: unknown;
  expiresAt: number;
};
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const loginCookie = { ...cookie, path: "/auth" };
const loginCookieName = (state: string) =>
  "sl_login_" + digest(state).slice(0, 32);
// Consume one browser-bound attempt atomically; never delete the user's session here.
async function takeLogin(req: Request, res: Response) {
  const state = req.query.state;
  if (typeof state !== "string" || state.length > 256) return null;
  const name = loginCookieName(state),
    sid = req.cookies?.[name];
  res.clearCookie(name, loginCookie);
  if (typeof sid !== "string" || sid.length > 100) return null;
  const row = (
    await db.query(
      "DELETE FROM sessions WHERE id_hash=$1 AND expires_at>now() RETURNING sealed",
      [digest("login:" + sid)],
    )
  ).rows[0];
  const pending = row ? unseal(row.sealed) : null;
  return pending?.kind === "pending" && pending.state === state
    ? pending
    : null;
}
function seal(s: Session) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(s), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}
function unseal(v: string): Session {
  const b = Buffer.from(v, "base64"),
    c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(),
  );
}
async function load(req: Request) {
  const sid = req.cookies?.sl_session;
  if (typeof sid !== "string" || sid.length > 100) return null;
  const row = (
    await db.query(
      "SELECT sealed FROM sessions WHERE id_hash=$1 AND expires_at>now()",
      [digest(sid)],
    )
  ).rows[0];
  return row ? unseal(row.sealed) : null;
}
async function save(sid: string, s: Session) {
  await db.query(
    "INSERT INTO sessions(id_hash,sealed,expires_at) VALUES($1,$2,$3) ON CONFLICT(id_hash) DO UPDATE SET sealed=$2,expires_at=$3",
    [digest(sid), seal(s), new Date(s.expiresAt)],
  );
}
async function remove(req: Request) {
  if (typeof req.cookies?.sl_session === "string")
    await db.query("DELETE FROM sessions WHERE id_hash=$1", [
      digest(req.cookies.sl_session),
    ]);
}
let config: oidc.Configuration | undefined;
async function provider() {
  if (!config)
    config = await oidc.discovery(
      new URL(issuer),
      "storeluma-web",
      process.env.OIDC_SECRET,
      undefined,
      {
        execute: issuer.startsWith("http:") ? [oidc.allowInsecureRequests] : [],
        [oidc.customFetch]: async (url, options) =>
          fetch(url.startsWith(issuer) ? url.replace(issuer, internal) : url, {
            ...options,
            body: options.body as BodyInit,
            signal: AbortSignal.timeout(10000),
          }),
      },
    );
  return config;
}
function csrfOK(req: Request, s: Session) {
  const got = Buffer.from(req.get("x-csrf-token") ?? ""),
    expected = Buffer.from(s.csrf ?? "");
  return (
    req.get("origin") === origin &&
    got.length === expected.length &&
    expected.length > 0 &&
    timingSafeEqual(got, expected)
  );
}
await migrate("gateway");
await start([], false, (app) => {
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.disable("x-powered-by");
  server.use(express.json({ limit: "40kb" }), cookieParser());
  server.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      "Cache-Control": "no-store",
    });
    next();
  });
  server.get("/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      await provider();
      res.json({ service: "gateway", status: "ok", version: appVersion });
    } catch {
      res.status(503).json({ status: "waiting" });
    }
  });
  server.get("/auth/login", async (req, res) => {
    // Redirect before setting cookies so 127.0.0.1 and localhost cannot split the flow.
    if (req.get("host") !== new URL(origin).host) {
      res.redirect(origin + "/auth/login");
      return;
    }
    if ((await load(req))?.kind === "user") {
      res.redirect("/");
      return;
    }
    const p = await provider(),
      verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    const sid = randomBytes(32).toString("base64url");
    await save("login:" + sid, {
      kind: "pending",
      verifier,
      state,
      nonce,
      expiresAt: Date.now() + 300000,
    });
    res.cookie(loginCookieName(state), sid, { ...loginCookie, maxAge: 300000 });
    res.redirect(
      oidc.buildAuthorizationUrl(p, {
        redirect_uri: origin + "/auth/callback",
        scope: "openid profile email",
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        nonce,
      }).href,
    );
  });
  server.get("/auth/callback", async (req, res) => {
    const pending = await takeLogin(req, res);
    if ((await load(req))?.kind === "user") {
      res.redirect("/");
      return;
    }
    if (!pending) {
      res.redirect("/?auth=expired");
      return;
    }
    try {
      const tokens = await oidc.authorizationCodeGrant(
        await provider(),
        new URL(req.originalUrl, origin),
        {
          pkceCodeVerifier: pending.verifier,
          expectedState: pending.state,
          expectedNonce: pending.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims()!;
      const sid = randomBytes(32).toString("base64url");
      const expiresAt =
        Date.now() + Math.min(tokens.expires_in ?? 900, 900) * 1000;
      await save(sid, {
        kind: "user",
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        csrf: randomBytes(24).toString("base64url"),
        expiresAt,
        user: {
          subjectId: claims.sub,
          name: claims.name,
          username: claims.preferred_username,
        },
      });
      res.cookie("sl_session", sid, {
        ...cookie,
        maxAge: expiresAt - Date.now(),
      });
      res.redirect("/");
    } catch (e) {
      console.warn("oidc_callback_rejected", {
        code: (e as { code?: string }).code,
      });
      res.redirect("/?auth=failed");
    }
  });
  server.get("/auth/session", async (req, res) => {
    const s = await load(req);
    if (s?.kind !== "user") {
      res.status(401).json({ message: "Cần đăng nhập." });
      return;
    }
    if (s.context) {
      // A saved selection is not a permission grant. Revalidate it against live business data.
      const selected = s.context as { tenantId: string; siteId: string };
      try {
        const result = await fetch(process.env.BUSINESS_URL + "/v1/context", {
          method: "POST",
          headers: {
            authorization: `Bearer ${s.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            tenantId: selected.tenantId,
            siteId: selected.siteId,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (result.ok) {
          const context = await result.json();
          if (JSON.stringify(context) !== JSON.stringify(s.context)) {
            s.context = context;
            await save(req.cookies.sl_session, s);
          }
        } else if ([403, 404, 409].includes(result.status)) {
          delete s.context;
          await save(req.cookies.sl_session, s);
        } else if (result.status === 401) {
          await remove(req);
          res.clearCookie("sl_session", cookie);
          res
            .status(401)
            .json({ message: "Phiên đã hết hạn. Vui lòng đăng nhập lại." });
          return;
        } else {
          res
            .status(503)
            .json({
              message:
                "Chưa kiểm tra được địa điểm làm việc. Vui lòng thử lại.",
            });
          return;
        }
      } catch {
        res
          .status(503)
          .json({
            message: "Chưa kiểm tra được địa điểm làm việc. Vui lòng thử lại.",
          });
        return;
      }
    }
    res.json({
      user: s.user,
      csrf: s.csrf,
      context: s.context,
      expiresAt: s.expiresAt,
    });
  });
  server.post("/auth/logout", async (req, res) => {
    const s = await load(req);
    if (s?.kind !== "user") {
      res.status(401).json({ message: "Phiên đã kết thúc." });
      return;
    }
    if (!csrfOK(req, s)) {
      res.status(403).json({ message: "Không xác minh được yêu cầu." });
      return;
    }
    await remove(req);
    res.clearCookie("sl_session", cookie);
    res.json({
      redirectUrl: oidc.buildEndSessionUrl(await provider(), {
        id_token_hint: s.idToken!,
        post_logout_redirect_uri: origin + "/",
      }).href,
    });
  });
  server.all("/v1/{*rest}", async (req, res) => {
    if (req.path.startsWith("/v1/internal/")) {
      res.status(404).json({ message: "Không tìm thấy." });
      return;
    }
    const s = await load(req);
    if (s?.kind !== "user") {
      res
        .status(401)
        .json({ message: "Phiên đã hết hạn. Vui lòng đăng nhập lại." });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method) && !csrfOK(req, s)) {
      res.status(403).json({ message: "Không xác minh được yêu cầu." });
      return;
    }
    try {
      const resource = req.path.match(
        /^\/v1\/tenants\/[^/]+\/(categories|products|skus|suppliers|receipts|stock-balances|stock-movements|stock-counts|stock-adjustments|payables)(?:\/|$)/,
      )?.[1];
      const target =
        resource && ["categories", "products", "skus"].includes(resource)
          ? process.env.CATALOG_URL
          : resource === "payables"
            ? process.env.FINANCE_URL
            : resource
              ? process.env.INVENTORY_URL
              : process.env.BUSINESS_URL;
      const result = await fetch(target + req.originalUrl, {
        method: req.method,
        headers: {
          authorization: `Bearer ${s.accessToken}`,
          "content-type": "application/json",
          ...(req.get("idempotency-key")
            ? { "idempotency-key": req.get("idempotency-key")! }
            : {}),
        },
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(8000),
      });
      const text = await result.text();
      if (req.path === "/v1/context" && result.ok) {
        s.context = JSON.parse(text);
        await save(req.cookies.sl_session, s);
      }
      res.status(result.status).type("application/json").send(text);
    } catch {
      res
        .status(503)
        .json({
          message: "Dịch vụ đang gián đoạn. Giữ mã thao tác và thử lại.",
        });
    }
  });
  server.use(express.static(resolve("apps/web/dist")));
  server.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/auth/") || req.path.startsWith("/v1/")) {
      res.status(404).json({ message: "Không tìm thấy." });
      return;
    }
    res.sendFile(resolve("apps/web/dist/index.html"));
  });
  server.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error("gateway_error", { name: (err as Error)?.name });
      res.status(500).json({ message: "Không thể xử lý yêu cầu." });
    },
  );
});
setInterval(() => {
  void db.query("DELETE FROM sessions WHERE expires_at<now()").catch(() => {});
}, 60000).unref();
