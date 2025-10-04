// ig.js — Instagram con opciones (👍 video / ❤️ documento o 1 / 2)
// Usa tu API Sky: https://api-sky.ultraplus.click
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api-sky.ultraplus.click";
const SKY_API_KEY = "Russellxz";    // <-- tu API key
const MAX_MB = 99;                  // límite de envío recomendado por WhatsApp

// memoria de trabajos pendientes por mensaje de preview
const pendingIG = Object.create(null);

const isIG = (u="") => /(instagram\.com|instagr\.am)/i.test(u);
const mb = n => n / (1024 * 1024);

function extFromCT(ct = "", def = "bin") {
  const c = ct.toLowerCase();
  if (c.includes("mp4")) return "mp4";
  if (c.includes("jpeg")) return "jpg";
  if (c.includes("jpg")) return "jpg";
  if (c.includes("png")) return "png";
  if (c.includes("webp")) return "webp";
  return def;
}

// Llama a tu API Sky (JS + fallback PHP)
async function callSkyInstagram(url) {
  const headers = { Authorization: `Bearer ${SKY_API_KEY}` };
  try {
    const r = await axios.get(`${API_BASE}/api/download/instagram`, {
      params: { url }, headers, timeout: 30000
    });
    if ((r.data?.status === "true" || r.data?.status === true) && r.data?.data?.media?.length) {
      return r.data.data;
    }
    throw new Error(r.data?.error || "no_media");
  } catch (e) {
    // fallback PHP si el .js no está disponible
    const r2 = await axios.get(`${API_BASE}/api/download/instagram.php`, {
      params: { url }, headers, timeout: 30000, validateStatus: s => s < 600
    });
    if ((r2.data?.status === "true" || r2.data?.status === true) && r2.data?.data?.media?.length) {
      return r2.data.data;
    }
    const msg = r2.data?.error || `HTTP ${r2.status}`;
    throw new Error(msg);
  }
}

async function downloadToTmp(fileUrl, preferExt = "bin") {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const res = await axios.get(fileUrl, {
    responseType: "stream",
    timeout: 120000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Referer: "https://www.instagram.com/",
      Accept: "*/*",
    },
    maxRedirects: 5,
    validateStatus: s => s < 400 // si 403/404, que arroje error
  });

  const ext = extFromCT(res.headers["content-type"], preferExt);
  const filePath = path.join(tmp, `ig-${Date.now()}-${Math.floor(Math.random() * 1e5)}.${ext}`);

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  return { path: filePath, mime: res.headers["content-type"] || "application/octet-stream" };
}

async function sendVideo(conn, chatId, filePath, asDocument, quoted, extraCaption = "") {
  const sizeMB = mb(fs.statSync(filePath).size);
  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(filePath); } catch {}
    return conn.sendMessage(chatId, {
      text: `❌ 𝙑𝙞𝙙𝙚𝙤 ≈ ${sizeMB.toFixed(2)} MB — supera el límite de ${MAX_MB} MB.\nTip: prueba como documento (a veces permite un poco más).`
    }, { quoted });
  }

  const caption =
`⚡ 𝗜𝗻𝘀𝘁𝗮𝗴𝗿𝗮𝗺 — 𝘃𝗶𝗱𝗲𝗼 𝗹𝗶𝘀𝘁𝗼
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
${extraCaption || ""}`.trim();

  await conn.sendMessage(chatId, {
    [asDocument ? "document" : "video"]: fs.readFileSync(filePath),
    mimetype: "video/mp4",
    fileName: `instagram-${Date.now()}.mp4`,
    caption: asDocument ? undefined : caption
  }, { quoted });

  try { fs.unlinkSync(filePath); } catch {}
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = (args.join(" ") || "").trim();
  const pref = global.prefixes?.[0] || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      text:
`✳️ 𝙐𝙨𝙖:
${pref}${command} <enlace IG>
Ej: ${pref}${command} https://www.instagram.com/reel/DPO9MwWjjY_/`
    }, { quoted: msg });
  }

  if (!isIG(text)) {
    return conn.sendMessage(chatId, {
      text:
`❌ 𝙀𝙣𝙡𝙖𝙘𝙚 𝙞𝙣𝙫𝙖́𝙡𝙞𝙙𝙤.

✳️ 𝙐𝙨𝙖:
${pref}${command} <enlace IG>`
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    // 1) Pide a tu API → solo tomaremos el PRIMER video
    const data  = await callSkyInstagram(text);
    const media = Array.isArray(data.media) ? data.media : [];
    const firstVideo = media.find(it => String(it.type || "").toLowerCase() === "video");

    if (!firstVideo) {
      return conn.sendMessage(chatId, {
        text: "🚫 𝙀𝙨𝙚 𝙚𝙣𝙡𝙖𝙘𝙚 𝙣𝙤 𝙩𝙞𝙚𝙣𝙚 𝙫𝙞𝙙𝙚𝙤 𝙙𝙚𝙨𝙘𝙖𝙧𝙜𝙖𝙗𝙡𝙚."
      }, { quoted: msg });
    }

    // 2) Mensaje de opciones (reacciones / números)
    const txt =
`⚡ 𝗜𝗻𝘀𝘁𝗮𝗴𝗿𝗮𝗺 — 𝗼𝗽𝗰𝗶𝗼𝗻𝗲𝘀

Elige cómo enviarlo:
👍 𝗩𝗶𝗱𝗲𝗼 (normal)
❤️ 𝗩𝗶𝗱𝗲𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— 𝗼 responde: 1 = video · 2 = documento

✦ 𝗔𝘂𝘁𝗼𝗿: ${data.author ? '@' + data.author : 'desconocido'}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    const preview = await conn.sendMessage(chatId, { text: txt }, { quoted: msg });

    // guarda el trabajo pendiente
    pendingIG[preview.key.id] = {
      chatId,
      url: firstVideo.url,
      quotedBase: msg
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    // listener único para IG
    if (!conn._igListener) {
      conn._igListener = true;
      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          try {
            // REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingIG[reactKey.id];
              if (job) {
                const asDoc = emoji === "❤️";
                await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });
                await conn.sendMessage(job.chatId, { text: `⏳ Descargando ${asDoc ? "como documento" : "video"}…` }, { quoted: job.quotedBase });

                const { path: fpath } = await downloadToTmp(job.url, "mp4");
                await sendVideo(conn, job.chatId, fpath, asDoc, job.quotedBase);
                delete pendingIG[reactKey.id];
              }
            }

            // RESPUESTAS con número 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const textLow =
              (m.message?.conversation ||
               m.message?.extendedTextMessage?.text ||
               "").trim().toLowerCase();

            if (replyTo && pendingIG[replyTo]) {
              const job = pendingIG[replyTo];
              if (textLow === "1" || textLow === "2") {
                const asDoc = textLow === "2";
                await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });
                await conn.sendMessage(job.chatId, { text: `⏳ Descargando ${asDoc ? "como documento" : "video"}…` }, { quoted: job.quotedBase });

                const { path: fpath } = await downloadToTmp(job.url, "mp4");
                await sendVideo(conn, job.chatId, fpath, asDoc, job.quotedBase);
                delete pendingIG[replyTo];
              } else {
                await conn.sendMessage(job.chatId, {
                  text: "⚠️ Responde con *1* (video) o *2* (documento), o reacciona con 👍 / ❤️.",
                }, { quoted: job.quotedBase });
              }
            }
          } catch (e) {
            console.error("IG listener error:", e);
          }
        }
      });
    }

  } catch (err) {
    console.error("❌ Error IG Sky:", err?.message || err);
    let msgTxt = "❌ Error al procesar el enlace.";
    const s = String(err?.message || "");
    if (/missing_param|invalid/i.test(s)) msgTxt = "❌ URL inválida o faltante.";
    else if (/no_media|no_video|422/i.test(s)) msgTxt = "🚫 No se encontró un video descargable en ese enlace.";
    else if (/401|api key|unauthorized|forbidden/i.test(s)) msgTxt = "🔐 API Key inválida o ausente en api-sky.ultraplus.click.";
    else if (/timeout|timed out|aborted|502|upstream/i.test(s)) msgTxt = "⚠️ La upstream tardó demasiado o no respondió.";
    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

module.exports.command = ["instagram","ig"];
module.exports.help = ["instagram <url>", "ig <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
