// استيراد مكتبة Telegraf
const { Telegraf, Markup } = require('telegraf'); // استيراد Markup لإنشاء الأزرار
const crypto = require('crypto'); // لاستخدام crypto.randomUUID() لتوليد معرفات فريدة

// توكن البوت الخاص بك (تم تضمينه بناءً على طلبك)
// يرجى ملاحظة أنه في بيئات الإنتاج، يفضل استخدام متغيرات البيئة لتخزين التوكن
const BOT_TOKEN = '7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA';

// إنشاء كائن بوت جديد
const bot = new Telegraf(BOT_TOKEN);

// تخزين مؤقت للهمسات السرية في الذاكرة
// يتم فقدان هذه الهمسات عند إعادة تشغيل البوت.
// Map<secretId, { message: string, recipientId: number, senderId: number, chatId: number, sentMessageId: number }>
const secretMessages = new Map();

// معالج أمر /start
// عندما يرسل المستخدم /start، سيقوم البوت بالرد برسالة ترحيب
bot.start((ctx) => {
    ctx.reply('أهلاً بك في بوت همسة! أنا هنا لأهمس لك ببعض الكلمات اللطيفة.\n\nلاستخدام الهمسة السرية في المجموعات، اكتب:\n`/secret @اسم_المستخدم همستك السرية هنا`\nأو\n`/secret معرف_المستخدم_الرقمي همستك السرية هنا`');
});

/**
 * معالج أمر /secret لإرسال رسائل سرية ضمن المجموعة.
 * لاستخدام هذا الأمر:
 * اكتب /secret @اسم_المستخدم <الهمسة السرية>
 * أو
 * اكتب /secret <معرف_المستخدم_الرقمي> <الهمسة السرية>
 *
 * مثال: /secret @john_doe هذه رسالة سرية لك وحدك!
 * مثال: /secret 123456789 هذه رسالة سرية لك وحدك!
 */
bot.command('secret', async (ctx) => {
    const senderId = ctx.from.id;
    const senderName = ctx.from.first_name || ctx.from.username || 'مستخدم مجهول';
    const messageText = ctx.message.text;
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;

    // يجب أن يكون الأمر في مجموعة
    if (chatType === 'private') {
        return ctx.reply('لا يمكن استخدام أمر /secret إلا في المجموعات لإرسال همسات سرية للآخرين.');
    }

    // تقسيم الرسالة لاستخراج المعرف والهمسة
    const args = messageText.split(' ').slice(1); // إزالة '/secret' من بداية الرسالة
    if (args.length < 2) {
        return ctx.reply('صيغة الأمر خاطئة. الاستخدام الصحيح: `/secret @اسم_المستخدم أو معرف_المستخدم_الرقمي ثم رسالتك السرية.`', { reply_to_message_id: ctx.message.message_id });
    }

    let targetIdentifier = args[0]; // @username أو معرف المستخدم
    const secretContent = args.slice(1).join(' '); // بقية الرسالة هي الهمسة السرية

    let recipientId;
    let recipientName = 'المستلم'; // اسم افتراضي للمستلم

    // محاولة استخراج معرف المستخدم من @mention
    if (ctx.message.entities) {
        const mentionEntity = ctx.message.entities.find(e => e.type === 'mention' || e.type === 'text_mention');
        if (mentionEntity) {
            if (mentionEntity.user) { // إذا كان المستخدم معروفاً للبوت (مثلاً تفاعل معه سابقاً)
                recipientId = mentionEntity.user.id;
                recipientName = mentionEntity.user.first_name || mentionEntity.user.username || 'المستلم';
            } else { // إذا كان مجرد @mention ولم يتمكن البوت من الحصول على ID
                // لا يمكن للبوت الحصول على ID المستخدم من مجرد @mention إلا إذا كان قد تفاعل مع البوت سابقاً.
                const username = messageText.substring(mentionEntity.offset + 1, mentionEntity.offset + mentionEntity.length);
                return ctx.reply(`عذراً، لا يمكنني تحديد معرف المستخدم لـ @${username}. يرجى التأكد من أن هذا المستخدم قد بدأ محادثة معي مسبقاً (عن طريق إرسال /start لي في الخاص) أو استخدم المعرف الرقمي للمستخدم.`, { reply_to_message_id: ctx.message.message_id });
            }
        }
    }

    // إذا لم يتم العثور على mention، حاول تحليل المعرف الرقمي
    if (!recipientId) {
        const parsedId = parseInt(targetIdentifier);
        if (!isNaN(parsedId)) {
            recipientId = parsedId;
            // لا يمكننا الحصول على اسم المستلم من المعرف الرقمي مباشرة هنا، سيبقى "المستلم"
        } else {
            return ctx.reply('الرجاء تحديد @اسم_المستخدم أو معرف_المستخدم_الرقمي الصحيح.', { reply_to_message_id: ctx.message.message_id });
        }
    }

    // لا تسمح للمستخدم بإرسال همسة سرية لنفسه
    if (recipientId === senderId) {
        return ctx.reply('لا يمكنك إرسال همسة سرية لنفسك!', { reply_to_message_id: ctx.message.message_id });
    }

    // توليد معرف فريد للهمسة
    const secretId = crypto.randomUUID();

    // تخزين الهمسة مؤقتاً
    secretMessages.set(secretId, {
        message: secretContent,
        recipientId: recipientId,
        senderId: senderId,
        chatId: chatId,
        originalMessageId: ctx.message.message_id // لتتبع الرسالة الأصلية التي تحتوي على الأمر
    });

    // إنشاء زر inline يسمح فقط للمستلم بفتحه
    const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('افتح الهمسة 🤫', `open_secret:${secretId}:${recipientId}`)
    ]);

    try {
        // إرسال رسالة عامة في المجموعة مع الزر
        const sentMessage = await ctx.reply(`همسة سرية جديدة من ${senderName} لـ ${recipientName || 'المستلم'}!`, keyboard);

        // تحديث معلومات الرسالة الأصلية في secretMessages لتشمل معرف الرسالة التي تم إرسالها
        const secretData = secretMessages.get(secretId);
        if (secretData) {
            secretData.sentMessageId = sentMessage.message_id;
            secretMessages.set(secretId, secretData);
        }

        // محاولة حذف رسالة الأمر الأصلية من المجموعة للحفاظ على سريتها
        // ملاحظة: يتطلب هذا أن يكون البوت مسؤولاً في المجموعة ولديه صلاحية "حذف الرسائل".
        try {
            await ctx.deleteMessage(ctx.message.message_id);
        } catch (deleteError) {
            console.warn(`لم يتمكن البوت من حذف رسالة الأمر الأصلية (${ctx.message.message_id}) في الدردشة ${chatId}. قد لا يمتلك البوت صلاحية حذف الرسائل.`, deleteError.message);
        }

    } catch (error) {
        console.error('خطأ عند إرسال رسالة الهمسة السرية في المجموعة:', error);
        ctx.reply('عذراً، حدث خطأ ما أثناء إرسال الهمسة السرية. يرجى المحاولة مرة أخرى لاحقاً.', { reply_to_message_id: ctx.message.message_id });
    }
});

// معالج استدعاءات الأزرار (callback queries)
bot.action(/open_secret:(.+):(\d+)/, async (ctx) => {
    const callbackData = ctx.match[0]; // open_secret:secretId:recipientId
    const secretId = ctx.match[1];
    const expectedRecipientId = parseInt(ctx.match[2]);
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || ctx.from.username || 'مستخدم';

    const secretData = secretMessages.get(secretId);

    if (!secretData) {
        // إذا لم يتم العثور على الهمسة (ربما تم إعادة تشغيل البوت أو انتهت صلاحيتها)
        await ctx.answerCbQuery('عذراً، هذه الهمسة لم تعد متاحة أو انتهت صلاحيتها.', { show_alert: true });
        // يمكننا محاولة تعديل الرسالة لإزالة الزر
        try {
            await ctx.editMessageText('هذه الهمسة لم تعد متاحة.');
        } catch (editError) {
            console.warn('فشل في تعديل رسالة الهمسة المنتهية الصلاحية:', editError.message);
        }
        return;
    }

    // التحقق مما إذا كان المستخدم الذي ضغط على الزر هو المستلم المقصود
    if (userId === expectedRecipientId) {
        // المستلم الصحيح، قم بالكشف عن الهمسة
        const secretMessage = secretData.message;
        let senderDisplayName = 'المرسل'; // اسم افتراضي للمرسل
        try {
            // محاولة الحصول على اسم المرسل من المجموعة للحصول على اسم أكثر دقة
            const senderChatMember = await bot.telegram.getChatMember(secretData.chatId, secretData.senderId);
            senderDisplayName = senderChatMember.user.first_name || senderChatMember.user.username || 'المرسل';
        } catch (e) {
            console.warn(`لم يتمكن من الحصول على معلومات المرسل (${secretData.senderId}):`, e.message);
        }

        try {
            // تعديل الرسالة في المجموعة للكشف عن الهمسة
            // سيتم عرض هذا التعديل لكل من في المجموعة، ولكن الرسالة تشير إلى أنها خاصة.
            await ctx.editMessageText(`همسة سرية من ${senderDisplayName} لـ ${userName}:\n\n"${secretMessage}"\n\n(هذه الهمسة مرئية لك فقط!)`);
            await ctx.answerCbQuery('تم فتح الهمسة بنجاح!', { show_alert: false });

            // يمكننا إزالة الهمسة من الذاكرة بعد عرضها لمنع إعادة فتحها أو للحفاظ على الذاكرة
            // secretMessages.delete(secretId); // قم بإلغاء التعليق إذا أردت أن تُفتح الهمسة مرة واحدة فقط

            // إضافة مؤقت لإعادة إخفاء الرسالة بعد فترة (مثلاً 60 ثانية)
            setTimeout(async () => {
                try {
                    // إعادة الرسالة إلى حالتها الأصلية مع الزر
                    await ctx.editMessageText(`همسة سرية جديدة من ${senderDisplayName} لـ ${userName}!`, Markup.inlineKeyboard([
                        Markup.button.callback('افتح الهمسة 🤫', `open_secret:${secretId}:${expectedRecipientId}`)
                    ]));
                    // إذا أردت حذف الهمسة من الذاكرة بعد إخفائها:
                    secretMessages.delete(secretId);
                } catch (rehideError) {
                    console.warn('فشل في إعادة إخفاء الهمسة:', rehideError.message);
                }
            }, 60000); // إخفاء بعد 60 ثانية (1 دقيقة)

        } catch (error) {
            console.error('خطأ عند تعديل الرسالة للكشف عن الهمسة:', error);
            await ctx.answerCbQuery('عذراً، حدث خطأ أثناء فتح الهمسة.', { show_alert: true });
        }
    } else {
        // المستخدم ليس المستلم المقصود
        await ctx.answerCbQuery('هذه الهمسة ليست لك! 🚫', { show_alert: true });
    }
});

// معالج الأخطاء العام للبوت
bot.catch((err, ctx) => {
    console.error(`خطأ للبوت ${ctx.updateType} في الدردشة ${ctx.chat ? ctx.chat.id : 'N/A'}:`, err);
    // يمكن هنا إضافة منطق تسجيل الأخطاء أو إرسال إشعار للمطور
    if (ctx.chat) {
        ctx.reply('عذراً، حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقاً.');
    }
});

// بدء تشغيل البوت
// هذا الأمر يجعل البوت يبدأ في الاستماع للرسائل الواردة
bot.launch();

// رسالة تأكيد عند بدء تشغيل البوت
console.log('بوت همسة يعمل الآن...');

// تمكين إيقاف التشغيل السلس في بيئات Vercel/Railway
// هذا يضمن أن البوت يتوقف بشكل صحيح عند إيقاف الخادم
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

