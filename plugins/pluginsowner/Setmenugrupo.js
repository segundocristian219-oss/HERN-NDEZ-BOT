// plugins/setmenugrupo.js
const fs = require("fs");
const path = require("path");

const DIGITS = (s = "") => String(s).replace(/\D/g, "");

/** Desencapsula viewOnce/ephemeral y retorna el nodo interno */
function unwrapMessage(m) {
  let node = m;
  while (
    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message
  ) {
    node =
      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;
  }
  return node;
}

/** Extrae texto del citado (preserva saltos/espacios) */
function getQuotedText(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.conversation || inner?.extendedTextMessage?.text || null;
}

/** Extrae imageMessage del citado (soporta ephemeral/viewOnce) */
function getQuotedImageMessage(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.imageMessage || null;
}

/** Obtiene wa.downloadContentFromMessage desde donde esté inyectado */
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, args, text, wa }) => {
  const chatId    = msg.key.remoteJid;
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderNum = DIGITS(senderJid);
  const fromMe    = !!msg.key.fromMe;

  // 🔐 Permisos: solo owners o el bot
  const isOwner = (typeof global.isOwner === "function")
    ? global.isOwner(senderNum)
    : (Array.isArray(global.owner) && global.owner.some(([id]) => id === senderNum));

  if (!isOwner && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 *Solo un Owner o el bot pueden configurar el C-Menu Grupo (global).*"
    }, { quoted: msg });
  }

  try { await conn.sendMessage(chatId, { react: { text: "🛠️", key: msg.key } }); } catch {}

  // — Texto crudo (conserva saltos/espacios). Quita solo 1 espacio inicial tras comando
  const textoArg   = typeof text === "string" ? text : (Array.isArray(args) ? args.join(" ") : "");
  const textoCrudo = textoArg.startsWith(" ") ? textoArg.slice(1) : textoArg;

  const quotedText  = !textoCrudo ? getQuotedText(msg) : null;
  const quotedImage = getQuotedImageMessage(msg);

  // Si no hay texto ni imagen, muestra uso
  if (!textoCrudo && !quotedText && !quotedImage) {
    return conn.sendMessage(chatId, {
      text: "✏️ *Uso:*\n• `setmenugrupo <texto>` (multilínea permitido)\n• O responde a una *imagen* y escribe: `setmenugrupo <texto>`"
    }, { quoted: msg });
  }

  // Descargar imagen si viene citada
  let imagenBase64 = null;
  if (quotedImage) {
    try {
      const WA = ensureWA(wa, conn);
      if (!WA) throw new Error("downloadContentFromMessage no disponible");
      const stream = await WA.downloadContentFromMessage(quotedImage, "image");
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length) imagenBase64 = buffer.toString("base64");
    } catch (e) {
      console.error("[setmenugrupo] error leyendo imagen citada:", e);
    }
  }

  const textoFinal = (textoCrudo || quotedText || "");

  // 💾 Guardado GLOBAL en setmenu.json
  const filePath = path.resolve("./setmenu.json");
  let data = {};
  try {
    data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {};
  } catch {
    data = {};
  }

  // Mantiene el texto anterior si no enviaron texto esta vez
  data.texto_grupo = textoFinal || data.texto_grupo || "";
  // Solo sobrescribe imagen si vino una nueva
  if (imagenBase64 !== null) data.imagen_grupo = imagenBase64;

  data.updatedAt_grupo = Date.now();

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  return conn.sendMessage(chatId, {
    text: `✅ *C-Menu Grupo (global) actualizado.*\n${
      textoFinal ? "• Texto: guardado" : "• Texto: (sin cambios)"
    }\n${
      imagenBase64 ? "• Imagen: guardada" : "• Imagen: (sin cambios)"
    }`
  }, { quoted: msg });
};

handler.command = ["setmenugrupo"];
handler.help = ["setmenugrupo <texto> (o respondiendo a imagen)"];
handler.tags = ["menu"];
module.exports = handler;
