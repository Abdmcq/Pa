
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const express = require('express');

// إعداد UptimeRobot Ping
const app = express();
app.get('/', (req, res) => res.send('🤖 البوت يعمل بنجاح!'));
app.listen(3000, () => console.log('✅ UptimeRobot جاهز على المنفذ 3000'));

const bot = new Telegraf('7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA');
const userSessions = new Map();

function sendMainMenu(ctx) {
  const buttons = [
    [{ text: '🎵 تعديل معلومات الأغنية', callback_data: 'edit_audio' }],
    [{ text: '✂️ قص جزء من أغنية', callback_data: 'trim' }],
    [{ text: '📝 تغيير اسم المستند', callback_data: 'rename' }],
    [{ text: '🗂️ تغيير اسم أي ملف', callback_data: 'rename_any' }],
  ];
  ctx.reply('🔘 القائمة الرئيسية:', {
    reply_markup: { inline_keyboard: buttons },
  });
}

bot.start((ctx) => sendMainMenu(ctx));

bot.on('callback_query', async (ctx) => {
  const mode = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  if (mode === 'back_to_menu') {
    userSessions.delete(userId);
    return sendMainMenu(ctx);
  }

  userSessions.set(userId, { mode });
  await ctx.answerCbQuery();

  switch (mode) {
    case 'edit_audio':
      await ctx.reply('🎧 أرسل لي ملف الأغنية (mp3 أو m4a...) لتعديل معلوماته.', {
        reply_markup: { inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'back_to_menu' }]] }
      });
      break;
    case 'trim':
      await ctx.reply('✂️ أرسل ملف الصوت ثم أرسل الوقت مثل: 00:30-01:00', {
        reply_markup: { inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'back_to_menu' }]] }
      });
      break;
    case 'rename':
      await ctx.reply('📝 أرسل الاسم الجديد للمستند:', {
        reply_markup: { inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'back_to_menu' }]] }
      });
      break;
    case 'rename_any':
      await ctx.reply('📂 أرسل الاسم الجديد لأي ملف:', {
        reply_markup: { inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'back_to_menu' }]] }
      });
      break;
  }
});

bot.on('message', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session) return;

  const text = ctx.message.text;

  switch (session.mode) {
    case 'rename_any':
      if (!session.newName) {
        session.newName = text;
        await ctx.reply('📎 الآن أرسل لي أي ملف تريد إعادة تسميته.');
      } else if (ctx.message.document || ctx.message.audio || ctx.message.video || ctx.message.voice) {
        const file = ctx.message.document || ctx.message.audio || ctx.message.video || ctx.message.voice;
        const fileLink = await ctx.telegram.getFileLink(file.file_id);
        const fileName = file.file_name || `${Date.now()}`;
        const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
        const inputPath = path.join(__dirname, fileName);
        const buffer = await fetch(fileLink.href).then(res => res.arrayBuffer());
        fs.writeFileSync(inputPath, Buffer.from(buffer));
        const newFileName = `${session.newName}${ext}`;
        const newPath = path.join(__dirname, newFileName);
        fs.renameSync(inputPath, newPath);
        await ctx.replyWithDocument({ source: newPath, filename: newFileName });
        fs.unlinkSync(newPath);
        userSessions.delete(userId);
      } else {
        await ctx.reply('❗ الرجاء إرسال ملف ليتم إعادة تسميته.');
      }
      break;
  }
});

bot.launch();
