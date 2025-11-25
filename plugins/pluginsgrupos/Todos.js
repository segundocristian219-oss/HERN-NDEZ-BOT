const handler = async (m, { conn, participants }) => {
  const total = participants.length;
  let texto = `*!  MENCION GENERAL  !*\n`;
  texto += `   *PARA ${total} MIEMBROS* 🔊\n\n`;

  for (const user of participants) {
    const numero = user.id.split('@')[0];
    texto += `┊» 🔊 @${numero}\n`;
  }

  await conn.sendMessage(m.chat, { react: { text: '🔊', key: m.key } });

  await conn.sendMessage(m.chat, {
    text: texto,
    mentions: participants.map(p => p.id)
  }, { quoted: m });
};

handler.customPrefix = /^\.?(todos)$/i;
handler.command = new RegExp();
handler.group = true;
handler.admin = true;
export default handler;