// --- استيراد المكتبات المطلوبة ---
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import NodeID3 from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';

// --- الإعدادات الأولية ---

// الحصول على مسار المجلد الحالي (مهم لوحدات ES)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// **نصيحة هامة:** لا تضع التوكن مباشرة في الكود.
// استخدم متغيرات البيئة (Environment Variables) لحماية التوكن الخاص بك.
// ستقوم بتعيين هذا المتغير في لوحة تحكم Render.
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('خطأ: لم يتم العثور على توكن البوت. الرجاء تعيين متغير البيئة BOT_TOKEN.');
  process.exit(1); // إيقاف التشغيل إذا لم يتم العثور على التوكن
}

const bot = new Telegraf(token);
const userSessions = new Map(); // لتخزين حالة كل مستخدم مؤقتًا

// --- إعداد خادم الويب (للتشغيل على Render) ---

const app = express();
const port = process.env.PORT || 3000;
// هذا الجزء يبقي البوت نشطًا على منصات مثل Render
app.get('/', (req, res) => res.send('🤖 Bot is alive and running!'));
app.listen(port, () => {
  console.log(`🚀 Web server has started on port ${port}`);
});


// --- الدوال المساعدة ---

/**
 * يعالج ملفات الصوت المستلمة من المستخدم
 * @param {import('telegraf').Context} ctx
 */
async function handleAudio(ctx) {
  const userId = ctx.from.id;
  const session = userSessions.get(userId) || {};
  // احفظ معلومات الملف سواء كان audio أو document
  session.audio = ctx.message.audio || ctx.message.document;
  userSessions.set(userId, session);

  if (session.mode === 'edit') {
    ctx.reply('📛 حسنًا، الآن أرسل اسم الأغنية الجديد:');
  } else if (session.mode === 'trim') {
    ctx.reply('⏱️ أرسل وقت البداية الذي تريد القص منه (بالثواني):');
  }
}

/**
 * يقوم بقص مقطع الصوت باستخدام ffmpeg
 * @param {import('telegraf').Context} ctx
 * @param {object} session
 */
async function trimAudio(ctx, session) {
  const userId = ctx.from.id;
  await ctx.reply('⏳ جاري قص المقطع الصوتي، يرجى الانتظار...');
  
  const inputPath = path.join(__dirname, `${userId}_${Date.now()}_input.tmp`);
  const outputPath = path.join(__dirname, `${userId}_${Date.now()}_trimmed.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const response = await fetch(fileLink.href);
    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(audioBuffer));

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(session.start)
        .setDuration(session.end - session.start)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم قص المقطع بنجاح!' });

  } catch (err) {
    console.error('Error in trimAudio:', err);
    ctx.reply('❌ حدث خطأ فادح أثناء محاولة قص المقطع. يرجى المحاولة مرة أخرى.');
  } finally {
    // تنظيف الجلسة والملفات المؤقتة في كل الحالات
    userSessions.delete(userId);
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

/**
 * خوارزمية تشفير مخصصة
 * @param {string} text النص المراد تشفيره
 * @param {number} complexity مستوى التعقيد
 * @returns {string} النص المشفر
 */
function customEncrypt(text, complexity) {
    let currentText = text;
    for (let i = 0; i < complexity; i++) {
        currentText = Array.from(currentText).map((char, index) => {
            const charCode = char.charCodeAt(0);
            const key = (index % 128) ^ (i * 5 + 3);
            return String.fromCharCode(charCode ^ key);
        }).join('');
    }
    const base64String = Buffer.from(currentText, 'utf-8').toString('base64');
    return `ARv6-${complexity}-${base64String}`;
}

/**
 * خوارزمية فك تشفير مخصصة
 * @param {string} encryptedText النص المشفر
 * @returns {string} النص الأصلي
 */
function customDecrypt(encryptedText) {
    if (!encryptedText.startsWith('ARv6-')) {
        throw new Error("صيغة النص المشفر غير صحيحة. يجب أن يبدأ بـ 'ARv6-'.");
    }
    const parts = encryptedText.split('-');
    if (parts.length < 3) {
        throw new Error("صيغة النص المشفر غير مكتملة.");
    }
    const complexity = parseInt(parts[1], 10);
    const base64String = parts.slice(2).join('-');
    let currentText = Buffer.from(base64String, 'base64').toString('utf-8');

    for (let i = complexity - 1; i >= 0; i--) {
        currentText = Array.from(currentText).map((char, index) => {
            const charCode = char.charCodeAt(0);
            const key = (index % 128) ^ (i * 5 + 3);
            return String.fromCharCode(charCode ^ key);
        }).join('');
    }
    return currentText;
}


// --- منطق البوت ومعالجات الأوامر (مرتبة حسب الأولوية) ---

// 1. أمر البدء
bot.start((ctx) => {
  userSessions.delete(ctx.from.id); // إعادة تعيين أي جلسة سابقة
  return ctx.reply(
    '🎵 أهلاً بك! اختر القسم الذي تريده من القائمة بالأسفل:',
    Markup.keyboard([
      ['🎧 تعديل معلومات أغنية'],
      ['✂️ قص أغنية'],
      ['🔐 تشفير / فك تشفير نصوص']
    ]).resize()
  );
});

// 2. معالجات القائمة الرئيسية
bot.hears('🎧 تعديل معلومات أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'edit' });
  ctx.reply('📤 ممتاز! الآن أرسل ملف الأغنية الذي تريد تعديله.');
});

bot.hears('✂️ قص أغنية', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'trim' });
  ctx.reply('📤 حسنًا، أرسل ملف الأغنية التي تريد قصها.');
});

bot.hears('🔐 تشفير / فك تشفير نصوص', (ctx) => {
  userSessions.set(ctx.from.id, { mode: 'crypto' });
  ctx.reply(`🧪 أرسل الأمر بالتنسيق الصحيح:

لتشفير نص (مستوى التعقيد من 1 إلى 10):
\`/encrypt 5 هذا نص تجريبي\`

لفك تشفير نص:
\`/decrypt ARv6-...\`
`, { parse_mode: 'Markdown' });
});

// 3. معالجات الأوامر المحددة (تم وضعها هنا لتعمل بشكل صحيح)

bot.hears(/^\/encrypt\s+(\d+)\s+(.+)/s, (ctx) => {
    const complexity = parseInt(ctx.match[1], 10);
    const text = ctx.match[2];

    if (isNaN(complexity) || complexity < 1 || complexity > 10) {
        return ctx.reply('❗ مستوى التعقيد يجب أن يكون رقمًا بين 1 و 10.');
    }
    try {
        const encrypted = customEncrypt(text, complexity);
        ctx.reply(`✅ تم التشفير بنجاح:\n\n\`${encrypted}\`\n\nيمكنك نسخ النص المشفر.`, { parse_mode: 'Markdown' });
    } catch (e) {
        ctx.reply(`❌ حدث خطأ أثناء التشفير: ${e.message}`);
    }
});

bot.hears(/^\/decrypt\s+(ARv6-.+)/s, (ctx) => {
    try {
        const decrypted = customDecrypt(ctx.match[1]);
        ctx.reply(`✅ تم فك التشفير بنجاح:\n\n${decrypted}`);
    } catch (e) {
        ctx.reply(`❌ خطأ في فك التشفير: ${e.message}`);
    }
});

bot.command('skip', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يمكنك استخدام هذا الأمر الآن. يرجى إكمال الخطوات السابقة أولاً.');
  }

  await ctx.reply('⏳ جاري تعديل البيانات بدون صورة، يرجى الانتظار...');
  const tempFile = path.join(__dirname, `${userId}_${Date.now()}_edited.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const response = await fetch(fileLink.href);
    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    const success = NodeID3.write({ title: session.title, artist: session.artist }, tempFile);
    if (!success) throw new Error('فشل في كتابة بيانات ID3.');

    await ctx.replyWithAudio(
        { source: tempFile },
        { title: session.title, performer: session.artist, caption: '✅ تم تعديل معلومات الأغنية بنجاح!' }
    );
  } catch (err) {
    console.error('Error in /skip command:', err);
    ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
  } finally {
    userSessions.delete(userId);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// 4. معالجات الوسائط (صوت، صور)
bot.on('audio', (ctx) => handleAudio(ctx));
bot.on('document', (ctx) => {
  const mime = ctx.message.document.mime_type || '';
  if (mime.startsWith('audio')) {
    handleAudio(ctx);
  } else {
    const session = userSessions.get(ctx.from.id);
    if (session && (session.mode === 'edit' || session.mode === 'trim')) {
        ctx.reply('❗ الملف المرسل ليس ملفًا صوتيًا. يرجى إرسال ملف صوتي.');
    }
  }
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (!session || session.mode !== 'edit' || !session.audio || !session.title || !session.artist) {
    return ctx.reply('❗ لا يمكنك إرسال صورة الآن. يرجى إكمال خطوات تعديل الأغنية أولاً.');
  }

  await ctx.reply('🖼️ تم استلام الصورة، جاري دمجها مع الأغنية...');
  const tempFile = path.join(__dirname, `${userId}_${Date.now()}_final.mp3`);

  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const photoLink = await ctx.telegram.getFileLink(photo.file_id);
    const imageResponse = await fetch(photoLink.href);
    const imageBuffer = await imageResponse.arrayBuffer();

    const audioLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const audioResponse = await fetch(audioLink.href);
    const audioBuffer = await audioResponse.arrayBuffer();
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    const success = NodeID3.write({
      title: session.title,
      artist: session.artist,
      image: {
        mime: 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover Art',
        imageBuffer: Buffer.from(imageBuffer)
      }
    }, tempFile);
    if (!success) throw new Error('فشل في كتابة بيانات ID3 مع الصورة.');

    await ctx.replyWithAudio(
        { source: tempFile },
        { title: session.title, performer: session.artist, caption: '✅ تم تعديل الأغنية والصورة بنجاح!' }
    );
  } catch (err) {
    console.error('Error in photo handler:', err);
    ctx.reply('❌ حدث خطأ أثناء دمج الصورة مع الملف.');
  } finally {
    userSessions.delete(userId);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// 5. المعالج العام للرسائل النصية (يأتي في النهاية لضمان عدم تعارضه مع الأوامر)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  const text = ctx.message.text;

  if (text.startsWith('/')) return;
  if (!session || !session.mode || session.mode === 'crypto') return;

  if (session.mode === 'edit') {
    if (!session.audio) return;
    if (!session.title) {
      session.title = text;
      ctx.reply('👤 رائع، الآن أرسل اسم الفنان:');
    } else if (!session.artist) {
      session.artist = text;
      ctx.reply('🖼️ ممتاز! الآن يمكنك إرسال صورة جديدة للأغنية، أو إرسال /skip لتخطي هذه الخطوة.');
    }
  } else if (session.mode === 'trim') {
    if (!session.audio) return;
    if (!session.hasOwnProperty('start')) {
      const startTime = parseFloat(text);
      if (isNaN(startTime) || startTime < 0) {
        return ctx.reply('❌ وقت بداية غير صالح. الرجاء إرسال رقم صحيح (مثل 0 أو 15).');
      }
      session.start = startTime;
      ctx.reply('🛑 حسنًا، الآن أرسل وقت النهاية (بالثواني):');
    } else if (!session.hasOwnProperty('end')) {
      const endTime = parseFloat(text);
      if (isNaN(endTime) || endTime <= session.start) {
        return ctx.reply('❌ وقت نهاية غير صالح. يجب أن يكون رقمًا وأكبر من وقت البداية.');
      }
      session.end = endTime;
      await trimAudio(ctx, session);
    }
  }
  if (userSessions.has(userId)) userSessions.set(userId, session);
});

// --- تشغيل البوت ---
bot.launch();
console.log('🤖 Bot has been launched and is running...');

// معالجة إيقاف البوت بأمان لضمان عدم انقطاع أي عمليات
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

