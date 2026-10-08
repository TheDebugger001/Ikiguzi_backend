const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { protect } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

const router = express.Router();
const uploadDir = path.resolve(__dirname, "../../uploads");
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE * MAX_FILES + 64 * 1024;
const imageTypes = {
  "image/jpeg": { extension: ".jpg", matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { extension: ".png", matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/gif": { extension: ".gif", matches: (b) => b.length >= 6 && ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)) },
  "image/webp": { extension: ".webp", matches: (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
};

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  const parts = [];
  let cursor = delimiter.length;
  if (!body.subarray(0, delimiter.length).equals(delimiter)) throw new Error("Malformed multipart form data.");

  while (cursor < body.length) {
    if (body.subarray(cursor, cursor + 2).toString() === "--") break;
    if (body.subarray(cursor, cursor + 2).toString() !== "\r\n") throw new Error("Malformed multipart form data.");
    cursor += 2;
    const headersEnd = body.indexOf("\r\n\r\n", cursor);
    if (headersEnd < 0) throw new Error("Malformed multipart form data.");
    const headers = body.subarray(cursor, headersEnd).toString("utf8");
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const field = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    const contentType = headers.match(/(?:^|\r\n)content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase();
    const dataStart = headersEnd + 4;
    const nextPart = body.indexOf(separator, dataStart);
    if (nextPart < 0) throw new Error("Malformed multipart form data.");
    if (filename !== undefined) parts.push({ field, contentType, data: body.subarray(dataStart, nextPart) });
    cursor = nextPart + separator.length;
  }
  return parts;
}

async function readRequestBody(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_SIZE) {
      res.status(413).json({ message: "Upload request is too large." });
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

router.post("/images", protect, checkStaffPermission("canManageProducts"), async (req, res) => {
  try {
    const contentType = req.headers["content-type"] || "";
    const boundary = contentType.match(/^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (!boundary) return res.status(400).json({ message: "Expected multipart form data." });
    const body = await readRequestBody(req, res);
    if (!body) return;

    const files = parseMultipart(body, boundary[1] || boundary[2]).filter((part) => part.field === "images");
    if (!files.length) return res.status(400).json({ message: "Select at least one image to upload." });
    if (files.length > MAX_FILES) return res.status(400).json({ message: `Upload no more than ${MAX_FILES} images at once.` });
    for (const file of files) {
      if (file.data.length > MAX_FILE_SIZE) return res.status(400).json({ message: "Each image must be 8 MB or smaller." });
      const type = imageTypes[file.contentType];
      if (!type || !type.matches(file.data)) return res.status(400).json({ message: "Only valid JPEG, PNG, WEBP, and GIF images are allowed." });
      file.extension = type.extension;
    }

    await fs.mkdir(uploadDir, { recursive: true });
    const names = files.map((file) => `${crypto.randomUUID()}${file.extension}`);
    await Promise.all(files.map((file, index) => fs.writeFile(path.join(uploadDir, names[index]), file.data, { flag: "wx" })));
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return res.status(201).json({ urls: names.map((name) => `${baseUrl}/uploads/${name}`) });
  } catch (error) {
    const status = error.message === "Malformed multipart form data." ? 400 : 500;
    return res.status(status).json({ message: status === 400 ? error.message : "Image upload failed." });
  }
});

module.exports = router;
module.exports.parseMultipart = parseMultipart;
