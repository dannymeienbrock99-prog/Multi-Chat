'use strict';
const { validateChatBackgroundFile } = require('./chat-background.cjs');

const LOCAL_CHAT_ICON_SIZE = 128;

function validateLocalChatIconSource(filePath) {
  const result = validateChatBackgroundFile(filePath);
  if (result.ok) return result;
  return {
    ...result,
    error:String(result.error || 'Das Bild konnte nicht gelesen werden.')
      .replaceAll('Chatbild', 'Chat-Icon')
      .replaceAll('Bilddatei', 'Icon-Datei')
  };
}

module.exports = { LOCAL_CHAT_ICON_SIZE, validateLocalChatIconSource };
