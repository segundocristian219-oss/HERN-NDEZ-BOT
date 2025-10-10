// plugins/checkTiempoGrupos.js
/*const fs = require("fs");
const path = require("path");

const handler = async (conn) => {
  setInterval(async () => {
    try {
      const filePath = path.resolve("setwelcome.json");
      if (!fs.existsSync(filePath)) return;

      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const ahora = Date.now();

      for (const chatId in data) {
        const info = data[chatId];

        // Cierre automático
if (info?.cerrar && ahora >= info.cerrar) {
  await conn.groupSettingUpdate(chatId, "announcement"); // grupo cerrado
  delete data[chatId].cerrar;

  await conn.sendMessage(chatId, {
    video: { url: "https://cdn.russellxz.click/1f9e8232.mp4" },
    caption: "🔒 El grupo ha sido cerrado automáticamente."
  });
}

        // Apertura automática
if (info?.abrir && ahora >= info.abrir) {
  await conn.groupSettingUpdate(chatId, "not_announcement"); // grupo abierto
  delete data[chatId].abrir;

  await conn.sendMessage(chatId, {
    video: { url: "https://cdn.russellxz.click/b5635057.mp4" },
    caption: "🔓 El grupo ha sido abierto automáticamente."
  });
}

        // Limpieza si no queda nada
        if (data[chatId] && Object.keys(data[chatId]).length === 0) {
          delete data[chatId];
        }
      }

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("❌ Error al procesar cierre/apertura programada:", err);
    }
  }, 10000); // cada 10 segundos
};

handler.run = handler;
module.exports = handler;
