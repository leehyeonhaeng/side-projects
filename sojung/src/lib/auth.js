import crypto from "crypto";

const SECRET = process.env.APP_SESSION_SECRET || "sojung-dev-secret-change-me";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "sojung_session";
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  const hashBuf = Buffer.from(hash, "hex");
  const candidateBuf = Buffer.from(candidate, "hex");
  return hashBuf.length === candidateBuf.length && crypto.timingSafeEqual(hashBuf, candidateBuf);
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

export function createSessionToken(passwordHash) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${sign(`${passwordHash}:${expiresAt}`)}`;
}

export function isSessionTokenValid(token, passwordHash) {
  if (!token || !passwordHash) return false;
  const [expiresAtStr, signature] = token.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!expiresAt || !signature || expiresAt < Date.now()) return false;

  const expected = sign(`${passwordHash}:${expiresAt}`);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
}
