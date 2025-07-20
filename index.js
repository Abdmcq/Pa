// index.js
// هذا الملف يحتوي على منطق بوت تليجرام "الهمس" باستخدام مكتبة Telegraf.

// استيراد المكتبات الضرورية
const { Telegraf, Markup } = require('telegraf'); // مكتبة Telegraf
const { v4: uuidv4 } = require('uuid'); // مكتبة لإنشاء معرفات فريدة (UUIDs)
const util = require('util'); // مكتبة Node.js الأصلية للمرافق (تستخدم هنا لـ inspect)

// --- إعدادات البوت الأساسية ---
// توكن البوت الخاص بك. (مضمن مباشرة لغرض التجربة فقط - استخدم متغيرات البيئة في الإنتاج)
const BOT_TOKEN = '7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA';

// معرف المالك (Telegram User ID). هذا مهم للتحكم في من يمكنه استخدام وظيفة الهمس.
// استبدل هذا بمعرف تليجرام الخاص بك.
const OWNER_ID = 1749717270; // مثال: 123456789 (استبدل بهذا)

// تهيئة بوت Telegraf
const bot = new Telegraf(BOT_TOKEN);
console.log('Telegram Whisper Bot (Telegraf) started...'); // رسالة تأكيد عند بدء تشغيل البوت

// --- تخزين الرسائل (في الذاكرة) ---
// لتسهيل التشغيل، سنستخدم قاموس في الذاكرة بدلاً من قاعدة بيانات.
// ملاحظة: ستفقد الرسائل عند إعادة تشغيل البوت.
const messageStore = {};

// --- دوال مساعدة ---

/**
 * دالة مشتركة لعرض رسالة الترحيب والمساعدة.
 * @param {object} ctx - كائن السياق (Context) من Telegraf.
 */
async function sendWelcomeMessage(ctx) {
    await ctx.replyWithMarkdown(
        "أهلاً بك في بوت الهمس!\n\n" +
        "لإرسال رسالة سرية في مجموعة، اذكرني في شريط الرسائل بالصيغة التالية:\n" +
        "`@اسم_البوت username1,username2 || الرسالة السرية || الرسالة العامة`\n\n" +
        "- استبدل `username1,username2` بأسماء المستخدمين أو معرفاتهم (IDs) مفصولة بفواصل.\n" +
        "- `الرسالة السرية` هي النص الذي سيظهر فقط للمستخدمين المحددين.\n" +
        "- `الرسالة العامة` هي النص الذي سيظهر لبقية أعضاء المجموعة عند محاولة قراءة الرسالة.\n" +
        "- يجب أن يكون طول الرسالة السرية أقل من 200 حرف، والطول الإجمالي أقل من 255 حرفًا.\n" +
        "\nملاحظة: لا تحتاج لإضافة البوت إلى المجموعة لاستخدامه."
    );
}

/**
 * دالة للتحقق مما إذا كان المستخدم هو المالك.
 * @param {number} userId - معرف المستخدم.
 * @returns {boolean} - صحيح إذا كان المستخدم هو المالك.
 */
function isOwner(userId) {
    return userId === OWNER_ID;
}

// --- معالج الأوامر ---

// معالج لأمر /start
bot.start(async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        console.log(`Ignoring /start from non-owner: ${ctx.from.id}`);
        return; // تجاهل بصمت
    }
    await sendWelcomeMessage(ctx);
});

// معالج لأمر /help
bot.help(async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        console.log(`Ignoring /help from non-owner: ${ctx.from.id}`);
        return; // تجاهل بصمت
    }
    await sendWelcomeMessage(ctx);
});

// --- معالج الاستعلامات المضمنة (Inline Mode) ---
bot.on('inline_query', async (ctx) => {
    const inlineQuery = ctx.inlineQuery;
    const queryText = inlineQuery.query.trim();
    const senderId = inlineQuery.from.id;
    const senderUsername = inlineQuery.from.username ? inlineQuery.from.username.toLowerCase() : null;

    console.log(`Received inline query from ${senderId} (@${senderUsername || 'N/A'}): "${queryText}"`);

    if (!isOwner(senderId)) {
        console.log(`Ignoring inline query from non-owner: ${senderId}`);
        const unauthorizedResult = {
            type: 'article',
            id: uuidv4(),
            title: 'غير مصرح لك',
            description: 'هذا البوت مخصص للمالك فقط.',
            input_message_content: {
                message_text: 'عذراً، لا يمكنك استخدام هذا البوت.',
            },
        };
        try {
            await ctx.answerInlineQuery([unauthorizedResult], { cache_time: 60 });
        } catch (e) {
            console.error(`Error sending unauthorized message to non-owner ${senderId}:`, e);
        }
        return;
    }

    try {
        const parts = queryText.split('||');
        if (parts.length !== 3) {
            const errorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ في التنسيق',
                description: 'يرجى استخدام: مستخدمين || رسالة سرية || رسالة عامة',
                input_message_content: {
                    message_text: 'تنسيق خاطئ. يرجى مراجعة /help',
                },
            };
            await ctx.answerInlineQuery([errorResult], { cache_time: 1 });
            return;
        }

        const targetUsersStr = parts[0].trim();
        const secretMessage = parts[1].trim();
        const publicMessage = parts[2].trim();

        // التحقق من طول الرسائل
        if (secretMessage.length >= 200 || queryText.length >= 255) {
            const lengthErrorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ: الرسالة طويلة جدًا',
                description: `السرية: ${secretMessage.length}/199, الإجمالي: ${queryText.length}/254`,
                input_message_content: {
                    message_text: 'الرسالة طويلة جدًا. يرجى مراجعة /help',
                },
            };
            await ctx.answerInlineQuery([lengthErrorResult], { cache_time: 1 });
            return;
        }

        // تنظيف قائمة المستخدمين المستهدفين
        const targetUsers = targetUsersStr.split(',').map(user => user.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
        if (targetUsers.length === 0) {
            const noUserErrorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ: لم يتم تحديد مستخدمين',
                description: 'يجب تحديد مستخدم واحد على الأقل.',
                input_message_content: {
                    message_text: 'لم يتم تحديد مستخدمين. يرجى مراجعة /help',
                },
            };
            await ctx.answerInlineQuery([noUserErrorResult], { cache_time: 1 });
            return;
        }

        // إنشاء Mentions (تنسيق HTML)
        const targetMentions = targetUsers.map(user => {
            // إذا كان يبدو كمعرف رقمي
            if (!isNaN(parseInt(user)) && String(parseInt(user)) === user) {
                return `<a href="tg://user?id=${user}">المستخدم ${user}</a>`;
            } else {
                // افتراض أنه اسم مستخدم
                return `@${user}`;
            }
        });
        const mentionsStr = targetMentions.join(', ');

        // إنشاء معرف فريد للرسالة وتخزينها
        const msgId = uuidv4();
        messageStore[msgId] = {
            senderId: String(senderId), // تحويل إلى String للمقارنة المتسقة
            senderUsername: senderUsername,
            targetUsers: targetUsers, // قائمة بأسماء المستخدمين والمعرفات (صغيرة)
            secretMessage: secretMessage,
            publicMessage: publicMessage,
        };
        console.log(`Stored message ${msgId}: ${util.inspect(messageStore[msgId], { depth: null })}`);

        // إنشاء الزر المضمن باستخدام Markup
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('اظهار الهمسة العامة', `whisper_${msgId}`)
        ]);

        // إنشاء نتيجة الاستعلام المضمن
        const result = {
            type: 'article',
            id: msgId,
            title: 'رسالة همس جاهزة للإرسال',
            description: `موجهة إلى: ${targetUsers.join(', ')}`,
            input_message_content: {
                message_text: `همسة عامة لهذا ${mentionsStr}\n\nاضغط على الزر أدناه لقراءتها.`,
                parse_mode: 'HTML', // تحديد وضع التنسيق هنا
                reply_markup: keyboard, // *** تم نقل هذا هنا لكي يظهر الزر في الرسالة المرسلة ***
            },
            // تم إزالة reply_markup: keyboard, من هنا
        };

        await ctx.answerInlineQuery([result], { cache_time: 1 });

    } catch (e) {
        console.error('Error in inline handler:', e);
        const genericErrorResult = {
            type: 'article',
            id: uuidv4(),
            title: 'حدث خطأ',
            description: 'حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى.',
            input_message_content: {
                message_text: 'عذراً، حدث خطأ ما أثناء معالجة طلبك.',
            },
        };
        await ctx.answerInlineQuery([genericErrorResult], { cache_time: 1 });
    }
});

// --- معالج ردود الأزرار المضمنة (Callback Query) ---
// استخدام bot.action للتعامل مع callback_data التي تبدأ بـ 'whisper_'
bot.action(/^whisper_/, async (ctx) => {
    try {
        const callbackData = ctx.callbackQuery.data;
        const msgId = callbackData.substring('whisper_'.length);
        const clickerId = String(ctx.from.id); // تحويل إلى String للمقارنة المتسقة
        const clickerUsername = ctx.from.username ? ctx.from.username.toLowerCase() : null;

        console.log(`Callback received for msg_id: ${msgId} from user: ${clickerId} (@${clickerUsername || 'N/A'})`);

        const messageData = messageStore[msgId];

        if (!messageData) {
            await ctx.answerCbQuery('عذراً، هذه الرسالة لم تعد متوفرة أو انتهت صلاحيتها.', { show_alert: true });
            console.warn(`Message ID ${msgId} not found in store.`);
            return;
        }

        // التحقق من صلاحية المستخدم
        let isAuthorized = false;
        if (clickerId === messageData.senderId) {
            isAuthorized = true;
        } else {
            for (const target of messageData.targetUsers) {
                if (target === clickerId || (clickerUsername && target === clickerUsername)) {
                    isAuthorized = true;
                    break;
                }
            }
        }

        console.log(`User ${clickerId} authorization status for msg ${msgId}: ${isAuthorized}`);

        // عرض الرسالة المناسبة
        if (isAuthorized) {
            let messageToShow = messageData.secretMessage;
            messageToShow += `\n\n(ملاحظة بقية الطلاب يشوفون هاي الرسالة مايشوفون الرسالة الفوگ: '${messageData.publicMessage}')`;
            await ctx.answerCbQuery(messageToShow, { show_alert: true });
            console.log(`Showing secret message for ${msgId} to user ${clickerId}`);
        } else {
            await ctx.answerCbQuery(messageData.publicMessage, { show_alert: true });
            console.log(`Showing public message for ${msgId} to user ${clickerId}`);
        }

    } catch (e) {
        console.error('Error in callback handler:', e);
        await ctx.answerCbQuery('حدث خطأ ما أثناء معالجة طلبك.', { show_alert: true });
    }
});

// معالجة أخطاء البوت العامة
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    // يمكنك إرسال رسالة خطأ عامة للمستخدم هنا إذا أردت
    // ctx.reply('عذراً، حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقاً.');
});

// بدء تشغيل البوت
bot.launch();

// تمكين الإيقاف النظيف في حالات إيقاف التطبيق (مثل Ctrl+C)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

