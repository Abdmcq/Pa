// =================================================================
// 1. استيراد المكتبات والإعدادات الأولية
// =================================================================
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import NodeID3 from 'node-id3';
import ffmpeg from 'fluent-ffmpeg';
import YtDlpWrap_ from 'yt-dlp-wrap';
import YouTube_ from 'youtube-sr';

// الإعدادات الأساسية
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const token = process.env.BOT_TOKEN || "7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA";

if (!token) {
  console.error('خطأ: توكن البوت (BOT_TOKEN) غير موجود.');
  process.exit(1);
}

// تهيئة المكتبات
const YtDlpWrap = YtDlpWrap_.default || YtDlpWrap_;
const ytDlpWrap = new YtDlpWrap();
const YouTube = YouTube_.default || YouTube_;
const bot = new Telegraf(token);
const userSessions = new Map();

// إعداد خادم الويب
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 Bot is alive and running!'));


// =================================================================
// 2. الدوال المساعدة والعمليات الأساسية (Helpers & Core Logic)
// =================================================================

async function handleDownload(ctx, url, format) {
    const userId = ctx.from.id;
    const isCallback = ctx.updateType === 'callback_query';
    let processingMessage;
    let outputPath = ''; 

    try {
        if (isCallback) {
            processingMessage = await ctx.editMessageText('⏳ جاري التحميل...');
        } else {
            processingMessage = await ctx.reply('⏳ جاري التحميل...');
        }
    
        const extension = format === 'video' ? 'mp4' : 'mp3';
        outputPath = path.join(__dirname, `${userId}_${Date.now()}_download.${extension}`);

        const videoFormatArgs = ['-f', 'best[ext=mp4]/best'];
        const audioFormatArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
        const dlpArgs = format === 'video' ? videoFormatArgs : audioFormatArgs;

        await ytDlpWrap.execPromise([url, ...dlpArgs, '-o', outputPath]);

        if (fs.existsSync(outputPath)) {
            const replyMethod = format === 'video' ? ctx.replyWithVideo : ctx.replyWithAudio;
            await replyMethod.call(ctx, { source: outputPath }, { caption: '✅ تم التحميل بنجاح!' });
        } else {
            throw new Error('لم يتم العثور على الملف الناتج.');
        }

    } catch (err) {
        console.error('Error in handleDownload:', err);
        let errorMessage = '❌ حدث خطأ أثناء التحميل.';
        isCallback ? await ctx.editMessageText(errorMessage).catch(() => {}) : await ctx.reply(errorMessage);
    } finally {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (isCallback) {
            await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
        } else if (processingMessage) {
            await ctx.deleteMessage(processingMessage.message_id).catch(() => {});
        }
    }
}

async function handleEditSong(ctx, session) {
    const userId = ctx.from.id;
    await ctx.reply('⏳ جاري تعديل معلومات الأغنية...');
    const tempFile = path.join(__dirname, `${userId}_${Date.now()}_edited.mp3`);
    try {
        const audioLink = await ctx.telegram.getFileLink(session.audio.file_id);
        const audioResponse = await fetch(audioLink.href);
        const audioBuffer = await audioResponse.arrayBuffer();
        fs.writeFileSync(tempFile, Buffer.from(audioBuffer));
        const tags = { title: session.title, artist: session.artist };
        if (session.image) {
            tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Cover Art', imageBuffer: session.image };
        }
        NodeID3.write(tags, tempFile);
        await ctx.replyWithAudio({ source: tempFile }, { caption: '✅ تم تعديل معلومات الأغنية بنجاح!' });
    } catch (err) {
        console.error('Error in handleEditSong:', err);
        ctx.reply('❌ حدث خطأ أثناء تعديل الملف.');
    } finally {
        userSessions.delete(userId);
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

async function applyAudioEffect(ctx, session, effect) {
    const userId = ctx.from.id;
    await ctx.editMessageText(`⏳ جاري تطبيق مؤثر "${effect.name}"...`);
    const inputPath = path.join(__dirname, `${userId}_${Date.now()}_effect_input.tmp`);
    const outputPath = path.join(__dirname, `${userId}_${Date.now()}_effect_output.mp3`);
    try {
        const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
        const response = await fetch(fileLink.href);
        const audioBuffer = await response.arrayBuffer();
        fs.writeFileSync(inputPath, Buffer.from(audioBuffer));
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath).audioFilter(effect.filter).output(outputPath).on('end', resolve).on('error', reject).run();
        });
        await ctx.replyWithAudio({ source: outputPath }, { caption: `✅ تم تطبيق مؤثر "${effect.name}" بنجاح!` });
    } catch (err) {
        console.error(`Error applying effect ${effect.name}:`, err);
        ctx.reply(`❌ حدث خطأ أثناء تطبيق المؤثر.`);
    } finally {
        userSessions.delete(userId);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    }
}

async function trimAudio(ctx, session) {
  const userId = ctx.from.id;
  await ctx.reply('⏳ جاري قص المقطع الصوتي...');
  const inputPath = path.join(__dirname, `${userId}_${Date.now()}_input.tmp`);
  const outputPath = path.join(__dirname, `${userId}_${Date.now()}_trimmed.mp3`);
  try {
    const fileLink = await ctx.telegram.getFileLink(session.audio.file_id);
    const response = await fetch(fileLink.href);
    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(audioBuffer));
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath).setStartTime(session.start).setDuration(session.end - session.start).output(outputPath).on('end', resolve).on('error', reject).run();
    });
    await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم قص المقطع بنجاح!' });
  } catch (err) {
    console.error('Error in trimAudio:', err);
    ctx.reply('❌ حدث خطأ أثناء قص المقطع.');
  } finally {
    userSessions.delete(userId);
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

async function mergeAudio(ctx, session) {
    const userId = ctx.from.id;
    await ctx.reply(`⏳ جاري دمج ${session.audioFiles.length} مقاطع...`);
    const tempDir = path.join(__dirname, `temp_${userId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const fileListPath = path.join(tempDir, 'filelist.txt');
    const outputPath = path.join(__dirname, `${userId}_${Date.now()}_merged.mp3`);
    try {
        for (let i = 0; i < session.audioFiles.length; i++) {
            const file = session.audioFiles[i];
            const fileLink = await ctx.telegram.getFileLink(file.file_id);
            const response = await fetch(fileLink.href);
            const audioBuffer = await response.arrayBuffer();
            const tempFilePath = path.join(tempDir, `audio_${i}.mp3`);
            fs.writeFileSync(tempFilePath, Buffer.from(audioBuffer));
            fs.appendFileSync(fileListPath, `file '${path.resolve(tempFilePath)}'\n`);
        }
        await new Promise((resolve, reject) => {
            ffmpeg().input(fileListPath).inputOptions(['-f', 'concat', '-safe', '0']).outputOptions('-c', 'copy').output(outputPath).on('end', resolve).on('error', reject).run();
        });
        await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم دمج المقاطع بنجاح!' });
    } catch (err) {
        console.error('Error in mergeAudio:', err);
        ctx.reply('❌ حدث خطأ أثناء الدمج.');
    } finally {
        userSessions.delete(userId);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function handleConversion(ctx, videoFile) {
    const userId = ctx.from.id;
    await ctx.reply('⏳ جاري تحويل الفيديو إلى صوت...');
    const inputPath = path.join(__dirname, `${userId}_${Date.now()}_input.tmp`);
    const outputPath = path.join(__dirname, `${userId}_${Date.now()}_converted.mp3`);
    try {
        const fileLink = await ctx.telegram.getFileLink(videoFile.file_id);
        const response = await fetch(fileLink.href);
        const videoBuffer = await response.arrayBuffer();
        fs.writeFileSync(inputPath, Buffer.from(videoBuffer));
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath).noVideo().audioCodec('libmp3lame').audioBitrate('192').save(outputPath).on('end', resolve).on('error', reject);
        });
        await ctx.replyWithAudio({ source: outputPath }, { caption: '✅ تم تحويل الفيديو إلى صوت بنجاح!' });
    } catch (err) {
        console.error('Error in handleConversion:', err);
        ctx.reply('❌ حدث خطأ أثناء تحويل الفيديو.');
    } finally {
        userSessions.delete(userId);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

function customEncrypt(text) {
    const complexity = 5;
    let currentText = text;
    for (let i = 0; i < complexity; i++) {
        currentText = Array.from(currentText).map((char, index) => String.fromCharCode(char.charCodeAt(0) ^ ((index % 128) ^ (i * 5 + 3)))).join('');
    }
    return `ARv6-${complexity}-${Buffer.from(currentText, 'utf-8').toString('base64')}`;
}

function customDecrypt(encryptedText) {
    if (!encryptedText.startsWith('ARv6-')) throw new Error("صيغة النص المشفر غير صحيحة.");
    const parts = encryptedText.split('-');
    if (parts.length < 3) throw new Error("صيغة النص المشفر غير مكتملة.");
    const complexity = parseInt(parts[1], 10);
    let currentText = Buffer.from(parts.slice(2).join('-'), 'base64').toString('utf-8');
    for (let i = complexity - 1; i >= 0; i--) {
        currentText = Array.from(currentText).map((char, index) => String.fromCharCode(char.charCodeAt(0) ^ ((index % 128) ^ (i * 5 + 3)))).join('');
    }
    return currentText;
}


// =================================================================
// 3. معالجات الأوامر الرئيسية والقائمة (Commands & Menu)
// =================================================================

bot.start((ctx) => {
  userSessions.delete(ctx.from.id);
  return ctx.reply(
    '🎵 أهلاً بك! أنا بوت شامل لإدارة الوسائط. اختر القسم الذي تريده من القائمة:',
    Markup.keyboard([
      ['🎧 تعديل أغنية', '✂️ قص أغنية'],
      ['🎶 دمج مقاطع', '🔊 مؤثرات صوتية'],
      ['📥 تحميل من رابط', '🔄 حولني'],
      ['🔐 تشفير / فك']
    ]).resize()
  );
});

bot.command('cancel', (ctx) => { userSessions.delete(ctx.from.id); ctx.reply('👍 تم إلغاء العملية الحالية بنجاح.'); });

bot.hears('🎧 تعديل أغنية', (ctx) => { userSessions.set(ctx.from.id, { mode: 'edit' }); ctx.reply('📤 أرسل ملف الأغنية لتعديل معلوماته.'); });
bot.hears('✂️ قص أغنية', (ctx) => { userSessions.set(ctx.from.id, { mode: 'trim' }); ctx.reply('📤 أرسل المقطع الصوتي لقصه.'); });
bot.hears('🎶 دمج مقاطع', (ctx) => { userSessions.set(ctx.from.id, { mode: 'merge', audioFiles: [] }); ctx.reply('📤 أرسل المقطع الصوتي الأول. اضغط /done عند الانتهاء.'); });
bot.hears('🔄 حولني', (ctx) => { userSessions.set(ctx.from.id, { mode: 'convert' }); ctx.reply('📹 أرسل الفيديو لتحويله إلى MP3.'); });
bot.hears('📥 تحميل من رابط', (ctx) => { userSessions.set(ctx.from.id, { mode: 'download' }); ctx.reply('🔗 أرسل الرابط:', Markup.inlineKeyboard([Markup.button.callback('🎬 فيديو', 'ask_video'), Markup.button.callback('🎵 صوت', 'ask_audio')])); });
bot.hears('🔐 تشفير / فك', (ctx) => { userSessions.set(ctx.from.id, { mode: 'crypto' }); ctx.reply('🧪 لتشفير نص، أرسله مع حرف `t` في النهاية.\nلفك التشفير، أرسل النص المشفر مع حرف `y`.\n\nمثال للتشفير: `مرحبا t`\nمثال للفك: `ARv6-... y`', { parse_mode: 'Markdown' }); });
bot.hears('🔊 مؤثرات صوتية', (ctx) => { userSessions.set(ctx.from.id, { mode: 'effects' }); ctx.reply('🎧 رائع! أرسل المقطع الصوتي الذي تريد إضافة مؤثرات إليه.'); });

bot.action(/ask_(video|audio)/, async (ctx) => {
    const format = ctx.match[1];
    const session = userSessions.get(ctx.from.id) || { mode: 'download' };
    session.downloadFormat = format;
    userSessions.set(ctx.from.id, session);
    await ctx.editMessageText(`👍 حسنًا، الآن أرسل الرابط ليتم تحميله كـ ${format}.`);
});


// =================================================================
// 4. معالجات الأوامر الخاصة والوضع المباشر
// =================================================================

bot.command('skip', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (session && session.mode === 'edit' && session.audio && session.title && session.artist) {
        await handleEditSong(ctx, session);
    } else {
        ctx.reply('❗ لا يمكنك استخدام هذا الأمر الآن.');
    }
});

bot.command('done', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (session && session.mode === 'merge' && session.audioFiles && session.audioFiles.length >= 2) {
        await mergeAudio(ctx, session);
    } else {
        ctx.reply('❗ يجب أن ترسل مقطعين على الأقل.');
    }
});

bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query;
    if (!query || query.length < 2) return;
    try {
        const searchResults = await YouTube.search(query, { limit: 15, type: 'video' });
        const results = searchResults.map(video => ({ 
            type: 'article', 
            id: video.id, 
            title: video.title || "فيديو بدون عنوان", 
            description: `المدة: ${video.durationFormatted || 'غير معروف'}`, 
            thumb_url: video.thumbnail?.url || 'https://placehold.co/120x90/000000/FFFFFF?text=YT', 
            input_message_content: { message_text: `/select_format ${video.id}` } 
        }));
        await ctx.answerInlineQuery(results, { cache_time: 10 });
    } catch (error) { console.error('Inline query error:', error); }
});

bot.hears(/^\/select_format (.+)/, (ctx) => ctx.reply('🤔 اختر الصيغة المطلوبة:', Markup.inlineKeyboard([Markup.button.callback('🎬 فيديو', `dl_video_${ctx.match[1]}`), Markup.button.callback('🎵 صوت', `dl_audio_${ctx.match[1]}`)])));
bot.action(/^dl_(video|audio)_(.+)/, (ctx) => handleDownload(ctx, `https://www.youtube.com/watch?v=${ctx.match[2]}`, ctx.match[1]));

const effects = {
    '8d': { name: '8D Audio', filter: 'apulsator=hz=0.08, pan=stereo|c0<c0+c1|c1<c0+c1' },
    'pitch_low': { name: 'صوت عميق', filter: 'asetrate=44100*0.8,aresample=44100' },
    'pitch_low_mild': { name: 'صوت عميق (خفيف)', filter: 'asetrate=44100*0.9,aresample=44100' },
    'pitch_high': { name: 'صوت حاد', filter: 'asetrate=44100*1.4,aresample=44100' }
};
bot.action(/^effect_(.+)/, async (ctx) => {
    const effectKey = ctx.match[1];
    const session = userSessions.get(ctx.from.id);
    if (session && session.mode === 'effects' && session.audio && effects[effectKey]) {
        await applyAudioEffect(ctx, session, effects[effectKey]);
    }
});


// =================================================================
// 5. المعالج الرئيسي للرسائل والملفات (Main Dispatcher)
// =================================================================

bot.on(['audio', 'video', 'document', 'photo'], async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);
    if (!session || !session.mode) return;

    const message = ctx.message;
    const file = message.audio || message.video || message.document || (message.photo && message.photo.slice(-1)[0]);
    const mime = file.mime_type || (message.photo ? 'image/jpeg' : '');

    switch (session.mode) {
        case 'edit':
            if (!session.audio && mime.startsWith('audio/')) {
                session.audio = file;
                userSessions.set(userId, session);
                ctx.reply(`✅ تم استلام الأغنية. الآن أرسل اسم الأغنية الجديد:`);
            } else if (session.audio && session.title && session.artist && mime.startsWith('image/')) {
                const photoLink = await ctx.telegram.getFileLink(file.file_id);
                const imageResponse = await fetch(photoLink.href);
                session.image = await imageResponse.buffer();
                await handleEditSong(ctx, session);
            }
            break;
        case 'trim':
            if (mime.startsWith('audio/')) {
                session.audio = file;
                userSessions.set(userId, session);
                ctx.reply(`✅ تم استلام الأغنية. الآن أرسل النطاق الزمني للقص بالنمط التالي:\n\`دقائق:ثواني-دقائق:ثواني\`\n\nمثال: \`0:15-1:30\``, { parse_mode: 'Markdown' });
            }
            break;
        case 'effects':
            if (mime.startsWith('audio/')) {
                session.audio = file;
                userSessions.set(userId, session);
                ctx.reply('🎧 اختر المؤثر المطلوب:', Markup.inlineKeyboard([
                    [Markup.button.callback('🎵 تقنية 8D الصوتية', 'effect_8d')],
                    [Markup.button.callback('🧔‍♂️ صوت عميق', 'effect_pitch_low'), Markup.button.callback('🧔‍♂️ صوت عميق (خفيف)', 'effect_pitch_low_mild')],
                    [Markup.button.callback('🧒 صوت حاد', 'effect_pitch_high')]
                ]));
            }
            break;
        case 'merge':
             if (mime.startsWith('audio/')) {
                session.audioFiles.push(file);
                userSessions.set(userId, session);
                ctx.reply(`✅ تمت إضافة المقطع رقم ${session.audioFiles.length}. أرسل التالي أو اضغط /done للدمج.`);
             }
            break;
        case 'convert':
            if (mime.startsWith('video/')) {
                await handleConversion(ctx, file);
            }
            break;
    }
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);
    const text = ctx.message.text;

    if (text.startsWith('/')) return; // تجاهل الأوامر مثل /start, /skip, /done

    // *** إصلاح منطق التحميل والتشفير ***
    // الخطوة 1: تحقق مما إذا كان المستخدم في جلسة نشطة
    if (session && session.mode) {
        switch (session.mode) {
            case 'crypto':
                const cryptoRegex = /^(.*)\s+(t|y)$/s;
                const cryptoMatch = text.match(cryptoRegex);
                if (cryptoMatch) {
                    const content = cryptoMatch[1];
                    const action = cryptoMatch[2];
                    try {
                        if (action === 't') {
                            const encrypted = customEncrypt(content);
                            ctx.reply(`✅ تم التشفير:\n\n\`${encrypted}\``, { parse_mode: 'Markdown' });
                        } else {
                            const decrypted = customDecrypt(content);
                            ctx.reply(`✅ تم فك التشفير:\n\n${decrypted}`);
                        }
                    } catch (e) { ctx.reply(`❌ حدث خطأ: ${e.message}`); }
                } else {
                    ctx.reply('❗ صيغة غير صحيحة. يرجى إرسال النص متبوعًا بـ `t` للتشفير أو `y` للفك.');
                }
                return; // إنهاء المعالجة هنا
            case 'download':
                if (session.downloadFormat) {
                    try {
                        new URL(text);
                        await handleDownload(ctx, text, session.downloadFormat);
                        userSessions.delete(userId);
                    } catch (_) {
                        ctx.reply('❌ الرابط الذي أرسلته غير صالح.');
                    }
                }
                return;
            case 'trim':
                if (!session.audio) return;
                const timeRangeRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
                const match = text.match(timeRangeRegex);
                if (!match) return ctx.reply('❌ صيغة الوقت غير صحيحة. مثال: `0:15-1:30`');
                const timeToSeconds = (ts) => ts.split(':').map(Number).reduce((acc, val) => acc * 60 + val, 0);
                const start = timeToSeconds(match[1]);
                const end = timeToSeconds(match[2]);
                if (isNaN(start) || isNaN(end) || end <= start) return ctx.reply('❌ أوقات غير صالحة.');
                session.start = start;
                session.end = end;
                await trimAudio(ctx, session);
                return;
            case 'edit':
                if (!session.audio) return;
                if (!session.title) {
                    session.title = text;
                    userSessions.set(userId, session);
                    ctx.reply('👤 رائع، الآن أرسل اسم الفنان:');
                } else if (!session.artist) {
                    session.artist = text;
                    userSessions.set(userId, session);
                    ctx.reply('🖼️ ممتاز! الآن أرسل صورة جديدة، أو اضغط /skip للتخطي.');
                }
                return;
        }
    }

    // الخطوة 2: إذا لم يكن المستخدم في جلسة، تحقق من وجود رابط للتحميل المباشر
    const urlRegex = /(https?:\/\/(?:www\.)?(?:(m\.)?youtube\.com|youtu\.be|tiktok\.com|instagram\.com)\/[^\s]+)/;
    const urlMatch = text.match(urlRegex);
    if (urlMatch) {
        await handleDownload(ctx, urlMatch[0], 'video');
        return;
    }
});


// =================================================================
// 6. تهيئة وتشغيل البوت (Initialization & Launch)
// =================================================================

app.listen(port, () => console.log(`🚀 Web server has started on port ${port}`));
bot.launch({ handlerTimeout: 600_000 });
console.log('🤖 Bot has been launched and is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

