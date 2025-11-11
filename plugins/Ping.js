// plugins/ping.js
// Compatible con Baileys ESM/CJS: NO importes '@whiskeysockets/baileys' aquí.
// Usa `wa` inyectado desde tu index.js o `conn.wa`.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// obtiene el módulo de Baileys para acceder a `proto`
function ensureWA(wa, conn) {
  if (wa && wa.proto) return wa;
  if (conn && conn.wa && conn.wa.proto) return conn.wa;
  if (global.wa && global.wa.proto) return global.wa;
  return null;
}

const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  try {
    try { await conn.sendMessage(chatId, { react: { text: "🏓", key: msg.key } }); } catch {}

    const start = Date.now();
    const sent = await conn.sendMessage(chatId, { text: "🏓 Pong..." }, { quoted: msg });
    const ping = Date.now() - start;
    const resultText = `🏓 Pong\n\n✅ Ping: ${ping} ms`;

    const WA = ensureWA(wa, conn);
    const proto = WA?.proto;

    if (isGroup && proto) {
      await sleep(100);
      try {
        await conn.relayMessage(
          chatId,
          {
            protocolMessage: {
              key: sent.key,
              type: 14, // edit
              editedMessage: proto.Message.fromObject({
                conversation: resultText
              })
            }
          },
          { messageId: sent.key.id }
        );
      } catch {
        // si falla la edición, enviamos un nuevo mensaje
        await conn.sendMessage(chatId, { text: resultText }, { quoted: msg });
      }
    } else {
      // en PV o si no hay proto, solo enviamos el resultado
      await conn.sendMessage(chatId, { text: resultText }, { quoted: msg });
    }

    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  } catch (e) {
    console.error("Error en ping:", e);
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    await conn.sendMessage(chatId, { text: "❌ Error calculando el ping." }, { quoted: msg });
  }
};

handler.command = ["ping"];
module.exports = handler;
