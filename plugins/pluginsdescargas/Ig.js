// comando: instagram / ig — usa SOLO tu endpoint .js de api-sky.ultraplus.click
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api-sky.ultraplus.click";
const SKY_API_KEY = process.env.SKY_API_KEY || global.SKY_API_KEY || ""; // coloca tu API Key aquí
const MAX_MB = 99;

function fmtBytesToMB(b) {
  return (b / (1024 * 1024));
}

async function callSkyInstagram(url) {
  if (!SKY_API_KEY) throw new Error("Falta SKY_API_KEY para api-sky.ultraplus.click");
  const r = await axios.get(`${API_BASE}/api/download/instagram`, {
    params: { url },
    headers: { Authorization: `Bearer ${SKY_API_KEY}` },
    timeout: 30000
  });
  const jd = r.data || {};
  if ((jd.status === "true" || jd.status === true) && jd.data?.media?.length) {
    return jd.data;
  }
  throw new Error(jd.error || "Sin media");
}

async function saveStreamToTmp(url, ext = "bin") {
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filename = `ig-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
  const filePath = path.join(tmpDir, filename);

  const res = await axios.get(url, { responseType: "stream", timeout: 120000 });
  const contentType = (res.headers["content-type"] || "").toLowerCase();
  const guessedExt =
    contentType.includes("mp4") ? "mp4" :
    contentType.includes("jpeg") ? "jpg" :
    contentType.includes("jpg")  ? "jpg" :
    contentType.includes("png")  ? "png" :
    contentType.includes("webp") ? "webp" : ext;

  const finalPath = filePath.replace(`.${ext}`, `.${guessedExt}`);

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(finalPath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  return { path: finalPath, mime: contentType || "application/octet-stream" };
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = (args.join(" ") || "").trim();
  const pref = global.prefixes?.[0] || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      text:
`✳️ 𝙐𝙨𝙖:
${pref}${command} <enlace>
Ej: ${pref}${command} https://www.instagram.com/p/CCoI4DQBGVQ/`
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    // 1) Pedimos a tu API (formato: { author, caption, shortcode, media: [{type,url,width,height}...] })
    const data = await callSkyInstagram(text);
    const items = data.media || [];
    const author = data.author ? `@${data.author}` : "desconocido";
    const total = items.length;

    if (!total) {
      return conn.sendMessage(chatId, { text: "❌ 𝙉𝙤 𝙨𝙚 𝙥𝙪𝙙𝙤 𝙤𝙗𝙩𝙚𝙣𝙚𝙧 𝙘𝙤𝙣𝙩𝙚𝙣𝙞𝙙𝙤 𝙙𝙚 𝙄𝙂." }, { quoted: msg });
    }

    // 2) Caption estilo Suki futurista
    const captionHeader =
`⚡ 𝗜𝗻𝘀𝘁𝗮𝗴𝗿𝗮𝗺 — 𝗗𝗲𝘀𝗰𝗮𝗿𝗴𝗮 𝗹𝗶𝘀𝘁𝗮

✦ 𝗔𝘂𝘁𝗼𝗿: ${author}
✦ 𝗜𝘁𝗲𝗺𝘀: ${total}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click

────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    // 3) Enviar cada media (respeta el límite de 99MB para videos)
    for (const [idx, m] of items.entries()) {
      const isVideo = String(m.type || "").toLowerCase() === "video";
      const url = m.url;

      // descarga a tmp
      const { path: fpath, mime } = await saveStreamToTmp(url, isVideo ? "mp4" : "jpg");
      const sizeMB = fmtBytesToMB(fs.statSync(fpath).size);

      if (isVideo) {
        if (sizeMB > MAX_MB) {
          // si excede, no se envía archivo; mandamos aviso + link directo
          fs.unlinkSync(fpath);
          await conn.sendMessage(chatId, {
            text:
`❌ 𝙑𝙞𝙙𝙚𝙤 ${idx + 1}/${total} ≈ ${sizeMB.toFixed(2)} MB — supera el límite de ${MAX_MB} MB.
🔗 𝙀𝙣𝙡𝙖𝙘𝙚: ${url}`
          }, { quoted: msg });
          continue;
        }

        // enviar video
        await conn.sendMessage(chatId, {
          video: fs.readFileSync(fpath),
          mimetype: "video/mp4",
          caption: idx === 0 ? captionHeader : undefined
        }, { quoted: msg });

        fs.unlinkSync(fpath);
      } else {
        // enviar imagen
        await conn.sendMessage(chatId, {
          image: fs.readFileSync(fpath),
          mimetype: mime || "image/jpeg",
          caption: idx === 0 ? captionHeader : undefined
        }, { quoted: msg });

        fs.unlinkSync(fpath);
      }
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Error en comando Instagram (Sky .js):", err?.message || err);
    await conn.sendMessage(chatId, {
      text: "❌ 𝙊𝙘𝙪𝙧𝙧𝙞𝙤́ 𝙪𝙣 𝙚𝙧𝙧𝙤𝙧 𝙖𝙡 𝙥𝙧𝙤𝙘𝙚𝙨𝙖𝙧 𝙚𝙡 𝙚𝙣𝙡𝙖𝙘𝙚 𝙙𝙚 𝙄𝙂."
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["instagram", "ig"];
handler.help = ["instagram <url>", "ig <url>"];
handler.tags = ["descargas"];
handler.register = true;

module.exports = handler;
