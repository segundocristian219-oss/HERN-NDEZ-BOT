// plugins/setfoto.js
const fs = require("fs");
const path = require("path");

const DIGITS = (s = "") => String(s).replace(/\D/g, "");

/** LID → JID real si viene @lid con .jid */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid) ? v.jid : v.id,
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch {
    return participants || [];
  }
}

/** Admin por número (sirve con LID y sin LID) */
async function isAdminByNumber(conn, chatId, number) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const raw  = Array.isArray(meta?.participants) ? meta.participants : [];
    const norm = lidParser(raw);

    const adminNums = new Set();
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i], n = norm[i];
      const flag = (r?.admin === "admin" || r?.admin === "superadmin" ||
                    n?.admin === "admin" || n?.admin === "superadmin");
      if (flag) {
        [r?.id, r?.jid, n?.id].forEach(x => {
          const d = DIGITS(x || "");
          if (d) adminNums.add(d);
        });
      }
    }
    return adminNums.has(number);
  } catch {
    return false;
  }
}

/** Desencapsula viewOnce/ephemeral para acceder al mensaje real */
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

/** Extrae la imageMessage del citado (soporta viewOnce/ephemeral) */
function getQuotedImageMessage(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.imageMessage || null;
}

/** Asegura acceso a wa.downloadContentFromMessage inyectado */
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, wa }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");
  const senderId = msg.key.participant || msg.key.remoteJid; // puede ser @lid
  const senderNo = DIGITS(senderId);
  const isFromMe = !!msg.key.fromMe;

  if (!isGroup) {
    await conn.sendMessage(chatId, { text: "❌ *Este comando solo se puede usar en grupos.*" }, { quoted: msg });
    return;
  }

  // Permisos: admin/owner/bot (LID-aware)
  const isAdmin = await isAdminByNumber(conn, chatId, senderNo);
  const ownersPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownersPath) ? JSON.parse(fs.readFileSync(ownersPath, "utf-8")) : [];
  const isOwner = Array.isArray(owners) && owners.some(([id]) => id === senderNo);

  if (!isAdmin && !isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "🚫 *Solo administradores o el Owner pueden cambiar la foto del grupo.*"
    }, { quoted: msg });
    return;
  }

  const quotedImage = getQuotedImageMessage(msg);
  if (!quotedImage) {
    await conn.sendMessage(chatId, {
      text: "⚠️ *Debes responder a una imagen para cambiar la foto del grupo.*"
    }, { quoted: msg });
    return;
  }

  const WA = ensureWA(wa, conn);
  if (!WA) {
    await conn.sendMessage(chatId, {
      text: "❌ *No se pudo acceder a la función de descarga de Baileys (`downloadContentFromMessage`).*"
    }, { quoted: msg });
    return;
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } }).catch(() => {});
    const stream = await WA.downloadContentFromMessage(quotedImage, "image");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    if (!buffer?.length) throw new Error("Buffer vacío al leer la imagen citada");

    // Baileys v6/v7: intentar nuevo formato primero y caer al antiguo si falla
    try {
      await conn.updateProfilePicture(chatId, { image: buffer });
    } catch (e1) {
      // Fallback (algunas versiones aceptan buffer directo)
      await conn.updateProfilePicture(chatId, buffer);
    }

    await conn.sendMessage(chatId, {
      text: "✅ *La foto del grupo ha sido actualizada con éxito.*"
    }, { quoted: msg });
  } catch (err) {
    console.error("❌ Error al cambiar la foto del grupo:", err);
    await conn.sendMessage(chatId, {
      text: "❌ *Error al actualizar la foto del grupo.*"
    }, { quoted: msg });
  }
};

handler.command = ["setfoto"];
module.exports = handler;
