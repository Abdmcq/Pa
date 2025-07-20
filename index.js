// index.js
// هذا الملف يحتوي على منطق بوت تليجرام "الهمس" باستخدام Node.js.

// استيراد المكتبات الضرورية
const TelegramBot = require('node-telegram-bot-api'); // مكتبة للتفاعل مع Telegram Bot API
const { v4: uuidv4 } = require('uuid'); // مكتبة لإنشاء معرفات فريدة (UUIDs)
const util = require('util'); // مكتبة Node.js الأصلية للمرافق (تستخدم هنا لـ inspect)

// --- إعدادات البوت الأساسية ---
// توكن البوت الخاص بك. (مضمن مباشرة لغرض التجربة فقط - استخدم متغيرات البيئة في الإنتاج)
const BOT_TOKEN = '7487838353:AAFmFXZ0PzjeFCz3x6rorCMlN_oBBzDyzEQ';

// معرف المالك (Telegram User ID). هذا مهم للتحكم في من يمكنه استخدام وظيفة الهمس.
// استبدل هذا بمعرف تليجرام الخاص بك.
const OWNER_ID = 1749717270; // مثال: 123456789 (استبدل بهذا)

// تهيئة بوت تليجرام
// `polling: true` تعني أن البوت سيبدأ في الاستماع للرسائل الجديدة بشكل مستمر
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Telegram Whisper Bot started...'); // رسالة تأكيد عند بدء تشغيل البوت

// --- تخزين الرسائل (في الذاكرة) ---
// لتسهيل التشغيل، سنستخدم قاموس في الذاكرة بدلاً من قاعدة بيانات.
// ملاحظة: ستفقد الرسائل عند إعادة تشغيل البوت.
const messageStore = {};

// --- دوال مساعدة ---

/**
 * دالة مشتركة لعرض رسالة الترحيب والمساعدة.
 * @param {object} message - كائن الرسالة من تليجرام.
 */
async function sendWelcomeMessage(message) {
    await bot.sendMessage(
        message.chat.id,
        "أهلاً بك في بوت الهمس!\n\n" +
        "لإرسال رسالة سرية في مجموعة، اذكرني في شريط الرسائل بالصيغة التالية:\n" +
        "`@اسم_البوت username1,username2 || الرسالة السرية || الرسالة العامة`\n\n" +
        "- استبدل `username1,username2` بأسماء المستخدمين أو معرفاتهم (IDs) مفصولة بفواصل.\n" +
        "- `الرسالة السرية` هي النص الذي سيظهر فقط للمستخدمين المحددين.\n" +
        "- `الرسالة العامة` هي النص الذي سيظهر لبقية أعضاء المجموعة عند محاولة قراءة الرسالة.\n" +
        "- يجب أن يكون طول الرسالة السرية أقل من 200 حرف، والطول الإجمالي أقل من 255 حرفًا.\n" +
        "\nملاحظة: لا تحتاج لإضافة البوت إلى المجموعة لاستخدامه.",
        { parse_mode: 'Markdown' } // تحديد وضع التنسيق
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
bot.onText(/\/start/, async (msg) => {
    if (!isOwner(msg.from.id)) {
        console.log(`Ignoring /start from non-owner: ${msg.from.id}`);
        return; // تجاهل بصمت
    }
    await sendWelcomeMessage(msg);
});

// معالج لأمر /help
bot.onText(/\/help/, async (msg) => {
    if (!isOwner(msg.from.id)) {
        console.log(`Ignoring /help from non-owner: ${msg.from.id}`);
        return; // تجاهل بصمت
    }
    await sendWelcomeMessage(msg);
});

// --- معالج الاستعلامات المضمنة (Inline Mode) ---
bot.on('inline_query', async (inlineQuery) => {
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
            await bot.answerInlineQuery(inlineQuery.id, [unauthorizedResult], { cache_time: 60 });
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
            await bot.answerInlineQuery(inlineQuery.id, [errorResult], { cache_time: 1 });
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
            await bot.answerInlineQuery(inlineQuery.id, [lengthErrorResult], { cache_time: 1 });
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
            await bot.answerInlineQuery(inlineQuery.id, [noUserErrorResult], { cache_time: 1 });
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

        // إنشاء الزر المضمن
        const keyboard = {
            inline_keyboard: [
                [{ text: 'اظهار الهمسة العامة', callback_data: `whisper_${msgId}` }]
            ]
        };

        // إنشاء نتيجة الاستعلام المضمن
        const result = {
            type: 'article',
            id: msgId,
            title: 'رسالة همس جاهزة للإرسال',
            description: `موجهة إلى: ${targetUsers.join(', ')}`,
            input_message_content: {
                message_text: `همسة عامة لهذا ${mentionsStr}\n\nاضغط على الزر أدناه لقراءتها.`,
                parse_mode: 'HTML', // تحديد وضع التنسيق هنا
            },
            reply_markup: keyboard,
        };

        await bot.answerInlineQuery(inlineQuery.id, [result], { cache_time: 1 });

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
        await bot.answerInlineQuery(inlineQuery.id, [genericErrorResult], { cache_time: 1 });
    }
});

// --- معالج ردود الأزرار المضمنة (Callback Query) ---
bot.on('callback_query', async (call) => {
    try {
        const callbackData = call.data;
        // التحقق مما إذا كانت بيانات الـ callback تبدأ بـ 'whisper_'
        if (!callbackData.startsWith('whisper_')) {
            await bot.answerCallbackQuery(call.id, { text: 'بيانات غير صالحة.', show_alert: true });
            return;
        }

        const msgId = callbackData.substring('whisper_'.length);
        const clickerId = String(call.from.id); // تحويل إلى String للمقارنة المتسقة
        const clickerUsername = call.from.username ? call.from.username.toLowerCase() : null;

        console.log(`Callback received for msg_id: ${msgId} from user: ${clickerId} (@${clickerUsername || 'N/A'})`);

        const messageData = messageStore[msgId];

        if (!messageData) {
            await bot.answerCallbackQuery(call.id, { text: 'عذراً، هذه الرسالة لم تعد متوفرة أو انتهت صلاحيتها.', show_alert: true });
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
            // في Node.js، لا يوجد حد أقصى لـ alert text مثل aiogram، لكن يمكننا قصها إذا أردت
            // if (messageToShow.length > 200) {
            //      messageToShow = messageData.secretMessage.substring(0, 150) + "... (الرسالة أطول من اللازم للعرض الكامل هنا)";
            // }
            await bot.answerCallbackQuery(call.id, { text: messageToShow, show_alert: true });
            console.log(`Showing secret message for ${msgId} to user ${clickerId}`);
        } else {
            await bot.answerCallbackQuery(call.id, { text: messageData.publicMessage, show_alert: true });
            console.log(`Showing public message for ${msgId} to user ${clickerId}`);
        }

    } catch (e) {
        console.error('Error in callback handler:', e);
        await bot.answerCallbackQuery(call.id, { text: 'حدث خطأ ما أثناء معالجة طلبك.', show_alert: true });
    }
});

// معالجة أخطاء الاستقصاء (polling errors)
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// معالجة أي رسائل أخرى غير الأوامر أو الاستعلامات المضمنة
bot.on('message', (msg) => {
    // هذا المعالج سيتلقى الرسائل العادية التي ليست أوامر أو استعلامات مضمنة
    // لا نحتاج للتعامل معها بشكل خاص في هذا البوت لأنه يعتمد على الوضع المضمن بشكل أساسي
    // يمكن إضافة رسالة "لا أفهم" هنا إذا أردت
});

