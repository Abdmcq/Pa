// استيراد مكتبة Telegraf
const { Telegraf, Markup } = require('telegraf'); // استيراد Markup لإنشاء الأزرار
const crypto = require('crypto'); // لاستخدام crypto.randomBytes لتوليد معرفات فريدة

// توكن البوت الخاص بك (تم تضمينه بناءً على طلبك)
// يرجى ملاحظة أنه في بيئات الإنتاج، يفضل استخدام متغيرات البيئة لتخزين التوكن
const BOT_TOKEN = '7892395794:AAHy-_f_ej0IT0ZLF1jzdXJDMccLiCrMrZA';

// إنشاء كائن بوت جديد
const bot = new Telegraf(BOT_TOKEN);

// تخزين مؤقت للهمسات السرية في الذاكرة
// يتم فقدان هذه الهمسات عند إعادة تشغيل البوت.
// Map<secretId, { message: string, recipientId: number, senderId: number, senderName: string }>
const secretMessages = new Map();

// معالج أمر /start
// عندما يرسل المستخدم /start، سيقوم البوت بالرد برسالة ترحيب
bot.start((ctx) => {
    ctx.reply('أهلاً بك في بوت همسة! أنا هنا لأهمس لك ببعض الكلمات اللطيفة.\n\nلاستخدام الهمسة السرية في أي محادثة، اكتب اسم البوت (@اسم_البوت_الخاص_بك) ثم:\n`@اسم_المستخدم همستك السرية هنا`\nأو\n`معرف_المستخدم_الرقمي همستك السرية هنا`\n\nمثال: `@' + ctx.botInfo.username + ' @YourFriendUsername هذه همسة سرية لك!`\n\nبعد كتابة الهمسة، اختر النتيجة وسيتم نشر رسالة. اضغط على الزر لفتح الهمسة كإشعار منبثق.');
});

// معالج الرسائل النصية العامة (لأي رسائل ليست أوامر أو استدعاءات)
// هذا المعالج سيتجاهل الرسائل التي تبدأ بـ '@' (لأنها قد تكون استدعاءات للبوت في وضع Inline)
bot.on('text', (ctx) => {
    const userMessage = ctx.message.text;
    // إذا كانت الرسالة تبدأ بـ '@' وتتضمن اسم البوت، فمن المحتمل أنها استدعاء Inline أو Mention، نتجاهلها هنا
    if (userMessage.startsWith('@') && userMessage.includes(ctx.botInfo.username)) {
        return;
    }
    console.log(`رسالة جديدة من ${ctx.from.first_name} (${ctx.from.id}): ${userMessage}`);

    // يمكنك إضافة المزيد من المنطق هنا للردود المختلفة
    if (userMessage.includes('كيف حالك')) {
        ctx.reply('أنا بخير طالما أنك بخير يا صديقي!');
    } else if (userMessage.includes('شكرا')) {
        ctx.reply('العفو، يسعدني أن أكون في خدمتك!');
    } else {
        ctx.reply('همسة لك: تذكر أنك رائع! إذا احتجت أي شيء، فقط اسأل.');
    }
});

/**
 * معالج استعلامات الوضع المضمن (Inline Mode).
 * يتم استدعاؤه عندما يكتب المستخدم @اسم_البوت_الخاص_بك في أي محادثة.
 */
bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const senderId = ctx.from.id;
    const senderName = ctx.from.first_name || ctx.from.username || 'مستخدم مجهول';

    // تقسيم الاستعلام إلى معرف المستلم والرسالة السرية
    const parts = query.split(' ');
    if (parts.length < 2) {
        // إذا كان الاستعلام غير مكتمل، اعرض تلميحاً
        return ctx.answerInlineQuery([], {
            cache_time: 0, // لا تخزن مؤقتاً
            is_personal: true, // النتائج شخصية للمستخدم
            // زر "Switch to PM" يوجه المستخدم إلى محادثة خاصة مع البوت
            // مع بارامتر 'start' ليتم إرسال /start
            switch_pm_text: 'كيفية استخدام همسة سرية (اضغط هنا للمساعدة)',
            switch_pm_parameter: 'start'
        });
    }

    let targetIdentifier = parts[0]; // @username أو معرف المستخدم الرقمي
    const secretContent = parts.slice(1).join(' '); // بقية الاستعلام هي الهمسة السرية

    let recipientId;
    let recipientName = 'المستلم'; // اسم افتراضي للمستلم

    // محاولة تحليل المعرف
    if (targetIdentifier.startsWith('@')) {
        // هذا هو اسم مستخدم. لا يمكن للبوت الحصول على ID المستخدم من مجرد @mention
        // في وضع Inline إلا إذا كان المستخدم قد تفاعل مع البوت مسبقاً.
        // لذلك، سنوجه المستخدم إلى استخدام المعرف الرقمي أو طلب من المستلم بدء محادثة مع البوت.
        return ctx.answerInlineQuery([], {
            cache_time: 0,
            is_personal: true,
            switch_pm_text: `لا يمكن تحديد ID لـ ${targetIdentifier}. يرجى استخدام المعرف الرقمي للمستخدم.`,
            switch_pm_parameter: 'start'
        });
    } else {
        // محاولة تحليل المعرف الرقمي
        const parsedId = parseInt(targetIdentifier);
        if (!isNaN(parsedId)) {
            recipientId = parsedId;
            // لا يمكننا الحصول على اسم المستلم من المعرف الرقمي مباشرة في Inline Mode
            // لذلك سنعرض "المستخدم [المعرف الرقمي]"
            recipientName = `المستخدم ${targetIdentifier}`;
        } else {
            return ctx.answerInlineQuery([], {
                cache_time: 0,
                is_personal: true,
                switch_pm_text: 'صيغة خاطئة. استخدم: @اسم_المستخدم أو معرف_المستخدم_الرقمي ثم الهمسة.',
                switch_pm_parameter: 'start'
            });
        }
    }

    // لا تسمح للمستخدم بإرسال همسة سرية لنفسه
    if (recipientId === senderId) {
        return ctx.answerInlineQuery([], {
            cache_time: 0,
            is_personal: true,
            switch_pm_text: 'لا يمكنك إرسال همسة سرية لنفسك!',
            switch_pm_parameter: 'start'
        });
    }

    // توليد معرف فريد للهمسة (32 حرفاً سداسي عشري)
    const secretId = crypto.randomBytes(16).toString('hex');

    // تخزين الهمسة مؤقتاً
    secretMessages.set(secretId, {
        message: secretContent,
        recipientId: recipientId,
        senderId: senderId,
        senderName: senderName // تخزين اسم المرسل لسهولة العرض لاحقاً
    });

    // إنشاء زر inline يسمح فقط للمستلم بفتحه
    const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('افتح الهمسة 🤫', `open_secret_popup:${secretId}:${recipientId}`)
    ]);

    // إعداد نتيجة Inline Query
    const results = [{
        type: 'article',
        id: secretId, // معرف فريد للنتيجة
        title: `إرسال همسة سرية لـ ${recipientName}`,
        description: `الهمسة: "${secretContent.substring(0, 50)}${secretContent.length > 50 ? '...' : ''}"`,
        input_message_content: {
            // هذا هو المحتوى الذي سيتم إرساله إلى الدردشة عند اختيار النتيجة
            message_text: `همسة سرية جديدة من ${senderName} لـ ${recipientName}!\n\nاضغط على الزر لفتح الهمسة.`,
            parse_mode: 'Markdown' // Markdown can be used here if you want to format the message
        },
        reply_markup: keyboard,
        thumb_url: 'https://placehold.co/48x48/000000/FFFFFF?text=🤫' // أيقونة صغيرة للنتيجة
    }];

    await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
});

// معالج استدعاءات الأزرار (callback queries) لفتح الهمسة كإشعار منبثق
bot.action(/open_secret_popup:(.+):(\d+)/, async (ctx) => {
    const secretId = ctx.match[1];
    const expectedRecipientId = parseInt(ctx.match[2]);
    const userId = ctx.from.id;
    const userName = ctx.from.first_name || ctx.from.username || 'مستخدم';

    const secretData = secretMessages.get(secretId);

    if (!secretData) {
        // إذا لم يتم العثور على الهمسة (ربما تم إعادة تشغيل البوت أو انتهت صلاحيتها)
        await ctx.answerCbQuery('عذراً، هذه الهمسة لم تعد متاحة أو انتهت صلاحيتها.', { show_alert: true });
        return;
    }

    // التحقق مما إذا كان المستخدم الذي ضغط على الزر هو المستلم المقصود
    if (userId === expectedRecipientId) {
        // المستلم الصحيح، قم بالكشف عن الهمسة في إشعار منبثق
        const secretMessage = secretData.message;
        const senderDisplayName = secretData.senderName; // استخدم الاسم المخزن من inline_query

        try {
            // عرض الهمسة كإشعار منبثق (pop-up)
            await ctx.answerCbQuery(`همسة سرية من ${senderDisplayName}:\n\n"${secretMessage}"`, { show_alert: true });

            // إزالة الهمسة من الذاكرة بعد عرضها لمنع إعادة فتحها
            secretMessages.delete(secretId);

            // يمكنك هنا تعديل الرسالة في الدردشة لإزالة الزر بعد الفتح
            // مثال:
            try {
                // إذا كانت الرسالة من Inline Query (وليس من أمر /secret في مجموعة)
                if (ctx.callbackQuery.inline_message_id) {
                    await ctx.editMessageReplyMarkup({
                        inline_message_id: ctx.callbackQuery.inline_message_id,
                        reply_markup: Markup.inlineKeyboard([
                             Markup.button.callback('تم فتح الهمسة ✅', 'secret_opened') // زر غير قابل للضغط أو مؤشر
                        ])
                    });
                } else if (ctx.callbackQuery.message) { // إذا كانت رسالة عادية (ليست inline)
                    await ctx.editMessageReplyMarkup({
                        chat_id: ctx.chat.id,
                        message_id: ctx.callbackQuery.message.message_id,
                        reply_markup: Markup.inlineKeyboard([
                            Markup.button.callback('تم فتح الهمسة ✅', 'secret_opened')
                        ])
                    });
                }
            } catch (editError) {
                console.warn('فشل في تعديل زر الهمسة بعد الفتح:', editError.message);
            }

        } catch (error) {
            console.error('خطأ عند عرض الهمسة كإشعار منبثق:', error);
            await ctx.answerCbQuery('عذراً، حدث خطأ أثناء فتح الهمسة.', { show_alert: true });
        }
    } else {
        // المستخدم ليس المستلم المقصود
        await ctx.answerCbQuery('هذه الهمسة ليست لك! 🚫', { show_alert: true });
    }
});

// معالج لأي أزرار "تم فتح الهمسة" لمنع أي تفاعل إضافي
bot.action('secret_opened', async (ctx) => {
    await ctx.answerCbQuery('لقد تم فتح هذه الهمسة بالفعل.', { show_alert: false });
});

// معالج الأخطاء العام للبوت
bot.catch((err, ctx) => {
    console.error(`خطأ للبوت ${ctx.updateType} في الدردشة ${ctx.chat ? ctx.chat.id : 'N/A'}:`, err);
    // يمكنك هنا إضافة منطق تسجيل الأخطاء أو إرسال إشعار للمطور
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

