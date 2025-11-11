// plugins/xxx2.js
const Checker = require("../libs/nsfw");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ——— helpers ———
function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}
function getQuotedMessage(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const ctxs = [
    root?.extendedTextMessage?.contextInfo,
    root?.imageMessage?.contextInfo,
    root?.videoMessage?.contextInfo,
    root?.audioMessage?.contextInfo,
    root?.documentMessage?.contextInfo,
    root?.stickerMessage?.contextInfo,
  ].filter(Boolean);
  for (const c of ctxs) if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  return null;
}
async function downloadToBuffer(DL, type, content) {
  const stream = await DL(content, type);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}
function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;

  // Preferir wa.downloadContentFromMessage si el dispatcher lo expone
  const DL = (wa && typeof wa.downloadContentFromMessage === "function")
    ? wa.downloadContentFromMessage
    : downloadContentFromMessage;

  try { await conn.sendMessage(chatId, { react: { text: "🔍", key: msg.key } }); } catch {}

  const quoted = getQuotedMessage(msg);
  if (!quoted) {
    return conn.sendMessage(
      chatId,
      { text: "❌ *Responde a un video, imagen o sticker para analizar NSFW.*" },
      { quoted: msg }
    );
  }

  let buffer = null, mimeType = "image/png";
  const tmpId = (msg.key.id || String(Date.now())).replace(/[^a-zA-Z0-9]/g, "");
  const inPath  = path.join(os.tmpdir(), `${tmpId}.mp4`);
  const outPath = path.join(os.tmpdir(), `${tmpId}.webp`);

  try {
    if (quoted.videoMessage) {
      // 1) Descargar video
      const vbuf = await downloadToBuffer(DL, "video", quoted.videoMessage);
      await fs.promises.writeFile(inPath, vbuf);

      // 2) Extraer 1 frame y convertir a webp 512x512 padded
      await new Promise((resolve, reject) => {
        ffmpeg(inPath)
          .outputOptions([
            "-vframes 1",
            "-vf",
            "thumbnail,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0,setsar=1",
            "-vcodec", "libwebp",
            "-q:v", "80"
          ])
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      });

      buffer = await fs.promises.readFile(outPath);
      mimeType = "image/webp";
    } else if (quoted.imageMessage || quoted.stickerMessage) {
      const isSticker = !!quoted.stickerMessage;
      const node = isSticker ? quoted.stickerMessage : quoted.imageMessage;
      const type = isSticker ? "sticker" : "image";
      buffer = await downloadToBuffer(DL, type, node);
      mimeType = node.mimetype || (isSticker ? "image/webp" : "image/png");
    } else {
      return conn.sendMessage(
        chatId,
        { text: "❌ *Tipo no soportado. Usa video, imagen o sticker.*" },
        { quoted: msg }
      );
    }

    // ——— Análisis NSFW ———
    const checker = new Checker();
    const result = await checker.response(buffer, mimeType);
    if (!result?.status) throw new Error(result?.msg || "Error desconocido del analizador.");

    const { NSFW, percentage, response } = result.result || {};
    const estado = NSFW ? "🔞 *NSFW detectado*" : "✅ *Contenido seguro*";
    await conn.sendMessage(
      chatId,
      { text: `${estado}\n📊 *Confianza:* ${percentage}\n\n${response || ""}`.trim() },
      { quoted: msg }
    );

    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}

  } catch (err) {
    console.error("[xxx] NSFW error:", err?.message || err);
    await conn.sendMessage(
      chatId,
      { text: `❌ *Error al analizar el archivo:* ${err?.message || "Fallo desconocido."}` },
      { quoted: msg }
    );
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
  } finally {
    safeUnlink(inPath);
    safeUnlink(outPath);
  }
};

handler.command = ["xxx"];
handler.tags = ["tools"];
handler.help = ["xxx <responde a un video, imagen o sticker>"];
handler.register = true;

module.exports = handler;
