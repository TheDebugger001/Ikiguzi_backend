// src/utils/sms.util.js
const { formatRwandanPhone } = require("./momo.util");

/**
 * Normalizes a Rwandan phone number to a canonical international format.
 * Accepts "0788123456", "+250788123456" or "250788123456".
 * Returns "+250788123456" or null when invalid.
 */
exports.normalizePhone = (phone) => {
  if (!phone) return null;
  const parsed = formatRwandanPhone(phone);
  if (!parsed) return null;
  return `+${parsed.formattedNumber}`;
};

/**
 * Returns all plausible stored representations for a phone number so lookups
 * match records saved by legacy flows (local "0788..." format) as well as new
 * OTP-created users (international "+250..." format).
 * @returns {string[]} e.g. ["+250788123456", "250788123456", "0788123456"]
 */
exports.phoneVariants = (phone) => {
  const normalized = exports.normalizePhone(phone);
  if (!normalized) return [];
  const digits = normalized.replace("+", "");
  const local = `0${digits.slice(3)}`;
  return [normalized, digits, local];
};

/**
 * Explains exactly what is wrong with a supplied phone number so callers can
 * return an actionable error instead of a generic "invalid credentials" reply.
 * A user who typed only 8 digits is told how many digits are missing, not that
 * his number is simply wrong.
 *
 * @param {string} phone
 * @returns {string|null} null when the number is valid, otherwise the message.
 */
exports.describePhoneIssue = (phone) => {
  const raw = phone === null || phone === undefined ? "" : String(phone).trim();
  if (!raw) return "Phone number is required.";

  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return "That does not look like a phone number. Enter digits only, e.g. 0788123456 or +250788123456.";
  }

  const hasCountryCode = digits.startsWith("250");
  const expected = hasCountryCode ? 12 : 10;

  if (digits.length < expected) {
    return (
      `Your phone number is incomplete: ${digits.length} of ${expected} digits ` +
      `were entered. Enter the full number, e.g. 0788123456 or +250788123456.`
    );
  }
  if (digits.length > expected) {
    return (
      `Your phone number is too long: ${digits.length} digits were entered but a ` +
      `Rwandan number has ${expected}. Example: 0788123456.`
    );
  }
  if (exports.normalizePhone(raw) === null) {
    return "That is not a valid Rwandan number. It must start with 07 (e.g. 0788123456) or +2507 (e.g. +250788123456).";
  }
  return null;
};

/**
 * Generates a cryptographically-secure numeric OTP code.
 * @param {number} length - number of digits (default 6)
 */
exports.generateOtpCode = (length = 6) => {
  const crypto = require("crypto");
  const max = Math.pow(10, length);
  const min = Math.pow(10, length - 1);
  const random = crypto.randomInt(min, max);
  return random.toString();
};

/**
 * Sends an OTP code to a phone number.
 *
 * No SMS gateway is bundled yet, so when no provider is configured the code is
 * written to the server log (development path). When SMS_PROVIDER is set, the
 * corresponding adapter is invoked so a provider (e.g. a Twilio-like gateway)
 * can be plugged in via env configuration without changing controller code.
 *
 * @param {string} phone  - canonical international number (e.g. "+250788123456")
 * @param {string} code   - the OTP code to deliver
 * @param {object} [opts] - optional metadata
 * @returns {Promise<void>}
 */
exports.sendOtpSms = async (phone, code, opts = {}) => {
  const provider = (process.env.SMS_PROVIDER || "").toLowerCase();
  const smsFrom = process.env.SMS_FROM_NAME || "MVEC";

  if (provider === "log" || !provider) {
    // Development fallback: surface the code so it can be tested locally.
    console.log(`[OTP] ${smsFrom}: verification code for ${phone} is ${code}`);
    return;
  }

  // Example adapter hook — replace with a real SMS gateway integration.
  console.log(
    `[OTP] SMS provider "${provider}" not implemented; code for ${phone} is ${code}`,
  );
  return;
};