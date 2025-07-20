// bot.js
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { message } = require('telegraf/filters');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); // For unique IDs
const LocalSession = require('telegraf-session-local'); // For session persistence
const { DateTime } = require('luxon'); // For timestamps

// --- Bot Configuration - Hardcoded Values (FOR EXPERIMENTAL USE ONLY) ---
// !!! IMPORTANT: Replace these placeholder values with your actual token/keys/ID !!!
const TELEGRAM_BOT_TOKEN = "7892395794:AAEUNB1UygFFcCbl7vxoEvH_DFGhjkfOlg8"; // استبدل بالتوكن الخاص بك
const GEMINI_API_KEY = "AIzaSyCtGuhftV0VQCWZpYS3KTMWHoLg__qpO3g"; // استبدل بمفتاحك
const OWNER_ID = 1749717270; // <--- !!! REPLACE THIS WITH YOUR NUMERICAL TELEGRAM USER ID !!!

// --- Owner and Bot Information ---
const OWNER_USERNAME = "ll7ddd"; // This can remain hardcoded
const BOT_PROGRAMMER_NAME = "عبدالرحمن حسن"; // This can remain hardcoded
const MCQS_FILENAME = "latest_mcqs.json";
const ATTEMPTED_USERS_FILENAME = "attempted_users.json"; // File for storing attempted users

// --- States for the conversation ---
const ASK_NUM_QUESTIONS_FOR_EXTRACTION = 'ASK_NUM_QUESTIONS_FOR_EXTRACTION';

// --- Initialize Bot ---
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Initialize session middleware for persistence
const sessionLocal = new LocalSession({ database: 'bot_data_persistence.json' });
bot.use(sessionLocal.middleware());

// --- Helper Functions ---

/**
 * Extracts text content from a PDF file.
 * @param {string} pdfPath - The path to the PDF file.
 * @returns {Promise<string>} - A promise that resolves with the extracted text.
 */
async function extractTextFromPdf(pdfPath) {
    try {
        const existingPdfBytes = await fs.readFile(pdfPath);
        // pdf-parse is used for actual text extraction from PDF bytes
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(existingPdfBytes);
        return data.text;
    } catch (error) {
        console.error(`Error extracting PDF text: ${error.message}`);
        return "";
    }
}

/**
 * Generates MCQs using the Gemini API.
 * @param {string} textContent - The text content to generate questions from.
 * @param {number} numQuestions - The number of questions to generate.
 * @param {string} language - The language for the questions (e.g., "English", "Arabic").
 * @returns {Promise<string>} - A promise that resolves with the generated MCQ text blob.
 */
async function generateMcqsTextBlobWithGemini(textContent, numQuestions, language = "Arabic") { // Changed default language to Arabic
    const apiModel = "gemini-1.5-flash-latest";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${GEMINI_API_KEY}`;
    const maxChars = 20000;
    textContent = textContent.length > maxChars ? textContent.substring(0, maxChars) : textContent;

    const prompt = `
    Generate exactly ${numQuestions} MCQs in ${language} from the text below.
    The questions should aim to comprehensively cover the key information and concepts from the entire provided text.

    STRICT FORMAT (EACH PART ON A NEW LINE):
    Question: [Question text, can be multi-line ending with ? or not]
    A) [Option A text]
    B) [Option B text]
    C) [Option C text]
    D) [Option D text]
    Correct Answer: [Correct option letter, e.g., A, B, C, or D]
    --- (Separator, USED BETWEEN EACH MCQ, BUT NOT after the last MCQ)

    Text:
    """
    ${textContent}
    """
    CRITICAL INSTRUCTIONS:
    1. Each question MUST have exactly 4 options (A, B, C, D). Do not generate questions with fewer than 4 options.
    2. Ensure question text is 10-290 characters long.
    3. Ensure each option text (A, B, C, D) is 1-90 characters long.
    4. The "Correct Answer:" line is CRITICAL and must be present for every MCQ.
    5. The "Correct Answer:" must be one of A, B, C, or D, corresponding to one of the provided options.
    6. Distractor options (incorrect answers) should be plausible but clearly incorrect based on the text.
    `;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }
    };
    const headers = { 'Content-Type': 'application/json' };

    try {
        const response = await axios.post(apiUrl, payload, { headers, timeout: 300000 }); // 5 minutes timeout
        const generatedTextCandidate = response.data.candidates;
        if (generatedTextCandidate && generatedTextCandidate.length > 0) {
            const contentParts = generatedTextCandidate[0].content?.parts;
            if (contentParts && contentParts.length > 0) {
                const generatedText = contentParts[0].text;
                console.debug(`Gemini RAW response (first 500 chars): ${generatedText.substring(0, 500)}`);
                return generatedText.trim();
            }
        }
        console.error(`Gemini API response missing expected structure. Response: ${JSON.stringify(response.data)}`);
        return "";
    } catch (error) {
        console.error(`Gemini API error: ${error.message}`);
        if (error.response) {
            console.error(`Gemini Response: ${error.response.data}`);
        }
        return "";
    }
}

const mcqParsingPattern = new RegExp(
    /Question:\s*(.*?)\s*\n/ +
    /A\)\s*(.*?)\s*\n/ +
    /B\)\s*(.*?)\s*\n/ +
    /C\)\s*(.*?)\s*\n/ +
    /D\)\s*(.*?)\s*\n/ +
    /Correct Answer:\s*([A-D])/i,
    's' // 's' flag for DOTALL equivalent
);

/**
 * Sends a single MCQ as a Telegram poll.
 * @param {string} mcqText - The text of the MCQ.
 * @param {object} ctx - The Telegraf context object.
 * @returns {Promise<boolean>} - True if the poll was sent successfully, false otherwise.
 */
async function sendSingleMcqAsPoll(mcqText, ctx) {
    const match = mcqParsingPattern.exec(mcqText.trim());
    if (!match) {
        console.warn(`Could not parse MCQ block for poll (format mismatch or not 4 options):\n-----\n${mcqText}\n-----`);
        return false;
    }
    try {
        const questionText = match[1].trim();
        const optionAText = match[2].trim();
        const optionBText = match[3].trim();
        const optionCText = match[4].trim();
        const optionDText = match[5].trim();
        const correctAnswerLetter = match[6].toUpperCase();

        const options = [optionAText, optionBText, optionCText, optionDText];

        if (!(questionText.length >= 10 && questionText.length <= 300)) {
            console.warn(`Poll Question text too long/short (${questionText.length} chars): "${questionText.substring(0, 50)}..."`);
            return false;
        }
        let validOptionsForPoll = true;
        for (let i = 0; i < options.length; i++) {
            if (!(options[i].length >= 1 && options[i].length <= 100)) {
                console.warn(`Poll Option ${i + 1} text too long/short (${options[i].length} chars): "${options[i].substring(0, 50)}..." for question "${questionText.substring(0, 50)}..."`);
                validOptionsForPoll = false;
                break;
            }
        }
        if (!validOptionsForPoll) return false;

        const letterToId = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
        const correctOptionId = letterToId[correctAnswerLetter];

        if (correctOptionId === undefined) {
            console.error(`Invalid correct_answer_letter '${correctAnswerLetter}'. MCQ:\n{mcqText}`);
            return false;
        }

        await ctx.telegram.sendPoll(
            ctx.chat.id,
            questionText,
            options,
            { type: 'quiz', correct_option_id: correctOptionId, is_anonymous: true }
        );
        return true;
    } catch (error) {
        console.error(`Error creating poll from MCQ block: ${error.message}\nMCQ:\n${mcqText}`);
        return false;
    }
}

/**
 * Loads attempted users data from a JSON file.
 * @returns {Promise<object>} - A promise that resolves with the attempted users object.
 */
async function loadAttemptedUsers() {
    try {
        const data = await fs.readFile(ATTEMPTED_USERS_FILENAME, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {}; // File not found, return empty object
        }
        console.error(`Error loading attempted users: ${error.message}`);
        return {};
    }
}

/**
 * Saves attempted users data to a JSON file.
 * @param {object} usersData - The object containing attempted user data.
 * @returns {Promise<void>}
 */
async function saveAttemptedUsers(usersData) {
    try {
        await fs.writeFile(ATTEMPTED_USERS_FILENAME, JSON.stringify(usersData, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error saving attempted users: ${error.message}`);
    }
}

/**
 * Handles restricted access for non-owner users.
 * @param {object} ctx - The Telegraf context object.
 * @param {string} attemptedFeatureName - The name of the feature attempted.
 */
async function handleRestrictedAccess(ctx, attemptedFeatureName = "ميزة محظورة") {
    const user = ctx.from;
    if (!user) return;

    const nowDt = DateTime.now().setZone('Asia/Baghdad'); // Set to Iraq timezone
    const nowStr = nowDt.toFormat("yyyy-MM-dd HH:mm:ss");

    const attemptedUsers = await loadAttemptedUsers();

    let isNewAttemptingUser = false;
    if (!attemptedUsers[user.id]) {
        attemptedUsers[user.id] = {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name || "N/A",
            username: user.username || "N/A",
            first_attempt_timestamp: nowStr
        };
        isNewAttemptingUser = true;
        await saveAttemptedUsers(attemptedUsers);
    }

    if (isNewAttemptingUser) {
        const attemptCount = Object.keys(attemptedUsers).length;
        const messageToOwner = (
            `⚠️ محاولة وصول جديدة للبوت (محاولة استخدام: ${attemptedFeatureName}):\n\n` +
            `👤 المستخدم رقم: ${attemptCount}\n` +
            `الاسم الأول: ${user.first_name}\n` +
            `الاسم الثاني: ${user.last_name || 'لا يوجد'}\n` +
            `المعرف: @${user.username || 'لا يوجد'}\n` +
            `الأيدي: \`${user.id}\`\n` +
            `تاريخ الدخول: ${nowStr}`
        );
        try {
            await ctx.telegram.sendMessage(OWNER_ID, messageToOwner, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error(`Failed to send owner notification for user ${user.id}: ${error.message}`);
        }
    }

    await ctx.reply(
        `عذراً، هذا البوت يعمل بشكل حصري لمبرمجه ${BOT_PROGRAMMER_NAME} (@${OWNER_USERNAME}).\n` +
        "لا يمكنك استخدام وظائفه حالياً."
    );
}

// --- Command Handlers ---

bot.start(async (ctx) => {
    if (ctx.from.id !== OWNER_ID) {
        await handleRestrictedAccess(ctx, "/start command");
        return;
    }

    await ctx.replyWithHTML(
        `مرحباً ${ctx.from.first_name}!\n` +
        `أرسل ملف PDF لاستخراج أسئلة منه. الأسئلة ستُحول إلى اختبارات (quiz polls) مع 4 خيارات لكل سؤال، وتُحفظ كنص في ملف.`
    );
});

bot.command('stats', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) {
        await handleRestrictedAccess(ctx, "/stats command");
        return;
    }

    const attemptedUsers = await loadAttemptedUsers();

    if (Object.keys(attemptedUsers).length === 0) {
        await ctx.reply("لم يحاول أي مستخدم الدخول إلى البوت حتى الآن.");
        return;
    }

    const totalUsers = Object.keys(attemptedUsers).length;

    let baseMessage = `📊 إحصائيات محاولات الوصول للبوت:\n\n`;
    baseMessage += `إجمالي عدد المستخدمين الذين حاولوا الدخول: ${totalUsers}\n\n`;
    baseMessage += "قائمة المستخدمين:\n";

    let messagesToSend = [baseMessage];
    let currentMessagePart = "";

    let i = 0;
    for (const uid in attemptedUsers) {
        const userData = attemptedUsers[uid];
        const userEntry = (
            `${i + 1}. الاسم: ${userData.first_name} ${userData.last_name}\n` +
            `   المعرف: @${userData.username}\n` +
            `   الأيدي: \`${uid}\`\n` +
            `   أول محاولة: ${userData.first_attempt_timestamp}\n` +
            `--------------------\n`
        );

        if ((currentMessagePart + userEntry).length > 4000) { // Telegram message limit is 4096
            messagesToSend.push(currentMessagePart);
            currentMessagePart = userEntry;
        } else {
            currentMessagePart += userEntry;
        }
        i++;
    }

    if (currentMessagePart) {
        messagesToSend.push(currentMessagePart);
    }

    for (const msgPart of messagesToSend) {
        if (msgPart.trim()) {
            await ctx.reply(msgPart, { parse_mode: 'Markdown' });
        }
    }
});

bot.command('cancel', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) {
        await handleRestrictedAccess(ctx, "/cancel command");
        return;
    }
    // Clear the session data for the current user
    ctx.session = {};
    await ctx.reply("تم إلغاء العملية.", Markup.removeKeyboard());
});

// --- Conversation Management (using Telegraf Scenes or simple session management) ---

// This example uses simple session management for the conversation state
bot.on(message('document'), async (ctx) => {
    if (ctx.from.id !== OWNER_ID) {
        await handleRestrictedAccess(ctx, "PDF Upload");
        return;
    }

    const document = ctx.message.document;
    if (document.mime_type !== "application/pdf") {
        await ctx.reply("من فضلك أرسل ملف PDF صالح.");
        return;
    }

    await ctx.reply("تم استلام ملف PDF. جاري معالجة النص...");

    try {
        const fileId = document.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await axios({ url: fileLink.href, method: 'GET', responseType: 'stream' });

        const tempDir = path.join(__dirname, 'temp_pdfs');
        await fs.mkdir(tempDir, { recursive: true });
        const pdfPath = path.join(tempDir, `${uuidv4()}.pdf`);

        const writer = fs.createWriteStream(pdfPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const textContent = await extractTextFromPdf(pdfPath);
        await fs.unlink(pdfPath); // Clean up temp file

        if (!textContent.trim()) {
            await ctx.reply("لم أتمكن من استخراج أي نص من ملف PDF.");
            return;
        }

        ctx.session.pdfTextForExtraction = textContent;
        ctx.session.state = ASK_NUM_QUESTIONS_FOR_EXTRACTION; // Set conversation state
        await ctx.reply("النص استخرج. كم سؤال (quiz poll) بأربعة خيارات تريد؟ مثال: 5. يمكنك طلب أي عدد (مثلاً 50).");

    } catch (error) {
        console.error(`Error handling document: ${error.message}`);
        await ctx.reply("حدث خطأ أثناء معالجة الملف.");
        // Clear session state on error to prevent being stuck
        ctx.session = {};
    }
});

bot.on(message('text'), async (ctx) => {
    if (ctx.from.id !== OWNER_ID) {
        // Restricted access is handled by specific command/document handlers.
        // If a non-owner sends text here, it's likely not part of a valid flow,
        // so we can just ignore or send a general restricted message if needed.
        return;
    }

    if (ctx.session.state === ASK_NUM_QUESTIONS_FOR_EXTRACTION) {
        const numQuestionsStr = ctx.message.text;
        let numQuestions;

        try {
            numQuestions = parseInt(numQuestionsStr, 10);
            if (isNaN(numQuestions) || numQuestions < 1) {
                await ctx.reply("الرجاء إرسال رقم صحيح موجب لعدد الأسئلة.");
                return;
            }
        } catch (error) {
            await ctx.reply("الرجاء إرسال رقم صحيح موجب لعدد الأسئلة.");
            return;
        }

        if (numQuestions > 50) {
            await ctx.reply(
                `لقد طلبت إنشاء ${numQuestions} اختباراً (4 خيارات لكل سؤال). ` +
                "قد تستغرق هذه العملية بعض الوقت. سأبذل قصارى جهدي!"
            );
        } else if (numQuestions > 20) {
             await ctx.reply(
                `جاري تجهيز ${numQuestions} اختباراً (4 خيارات لكل سؤال). قد يستغرق هذا بضع لحظات...`
            );
        }

        const pdfText = ctx.session.pdfTextForExtraction;
        if (!pdfText) {
            await ctx.reply("خطأ: نص PDF غير موجود. أعد إرسال الملف.");
            ctx.session = {}; // Clear session state
            return;
        }

        await ctx.reply(`جاري استخراج ${numQuestions} سؤالاً (4 خيارات لكل سؤال) وتحويلها إلى اختبارات...`, Markup.removeKeyboard());

        const generatedMcqTextBlob = await generateMcqsTextBlobWithGemini(pdfText, numQuestions, "Arabic"); // Explicitly request Arabic MCQs

        if (!generatedMcqTextBlob) {
            await ctx.reply("لم أتمكن من استخراج أسئلة من النموذج باستخدام Gemini API.");
            ctx.session = {}; // Clear session state
            return;
        }

        const individualMcqsTexts = generatedMcqTextBlob
            .split(/\s*---\s*/)
            .map(mcq => mcq.trim())
            .filter(mcq => mcq && mcq.includes("Correct Answer:") && mcq.includes("D)"));

        if (individualMcqsTexts.length === 0) {
            await ctx.reply("لم يتمكن Gemini من إنشاء أسئلة بالتنسيق المطلوب (4 خيارات) أو النص المستخرج فارغ.");
            console.warn(`Gemini blob did not yield valid 4-option MCQs: ${generatedMcqTextBlob.substring(0, 300)}`);
            ctx.session = {}; // Clear session state
            return;
        }

        const actualGeneratedCount = individualMcqsTexts.length;
        if (actualGeneratedCount < numQuestions) {
            await ctx.reply(
                `تم طلب ${numQuestions} اختباراً، ولكن تمكنت من إنشاء ${actualGeneratedCount} اختباراً فقط بالتنسيق المطلوب (4 خيارات). ` +
                "قد يكون هذا بسبب طبيعة النص المدخل أو استجابة Gemini."
            );
        }

        try {
            await fs.writeFile(MCQS_FILENAME, JSON.stringify(individualMcqsTexts, null, 2), 'utf8');
            console.info(`Saved ${actualGeneratedCount} MCQs text (4-options) to ${MCQS_FILENAME}`);
            await ctx.replyWithMarkdown(`تم حفظ نصوص ${actualGeneratedCount} سؤال في \`${MCQS_FILENAME}\`.\n` +
                                        "جاري الآن إنشاء اختبارات (quiz polls)...");
        } catch (error) {
            console.error(`Could not write to ${MCQS_FILENAME}: ${e.message}`);
            await ctx.reply(`فشل حفظ نصوص الأسئلة في ملف. سأحاول إنشاء ${actualGeneratedCount} اختباراً.`);
        }

        let pollsCreatedCount = 0;
        const delayBetweenPolls = 250; // milliseconds

        for (const mcqTextItem of individualMcqsTexts) {
            if (await sendSingleMcqAsPoll(mcqTextItem, ctx)) {
                pollsCreatedCount++;
            }
            if (actualGeneratedCount > 10) {
                await new Promise(resolve => setTimeout(resolve, delayBetweenPolls));
            }
        }

        let finalMessage = `انتهت العملية.\n`;
        finalMessage += `تم إنشاء ${pollsCreatedCount} اختبار (quiz poll) بنجاح (من أصل ${actualGeneratedCount} سؤال تم إنشاؤه بواسطة Gemini بالتنسيق المطلوب).`;
        if (pollsCreatedCount < actualGeneratedCount) {
            finalMessage += `\nتعذر إنشاء ${actualGeneratedCount - pollsCreatedCount} اختبار بسبب مشاكل في التنسيق لم يتم التعرف عليها أو حدود تيليجرام.`;
        }

        await ctx.reply(finalMessage);
        ctx.session = {}; // Clear session state after conversation ends
    } else {
        // If no active conversation state, and it's the owner,
        // you might want to give a hint or just ignore.
        // For non-owners, this should already be handled.
        if (ctx.from.id === OWNER_ID) {
            await ctx.reply("أرسل ملف PDF للبدء، أو استخدم /start.");
        }
    }
});

// --- Error Handling ---
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}`, err);
    if (ctx.message && ctx.from.id === OWNER_ID) {
        ctx.reply(`عذراً، حدث خطأ ما: ${err.message}`);
    } else if (ctx.message) {
        ctx.reply("عذراً، حدث خطأ ما داخلياً.");
    }
});

// --- Main Function to Start the Bot ---
async function main() {
    // A simple check for the placeholder ID
    if (OWNER_ID === 1749717270) {
        console.warn("OWNER_ID is set to the placeholder value. Please replace it with your actual Telegram User ID.");
        console.log("\n" + "=".repeat(50));
        console.log("IMPORTANT: Please open bot.js and replace '1749717270'");
        console.log("with your actual numerical Telegram User ID for the bot to function correctly for you.");
        console.log("=".repeat(50) + "\n");
        // process.exit(1); // Optionally, prevent the bot from starting if ID is not set.
    }
    // Similar checks for TELEGRAM_BOT_TOKEN and GEMINI_API_KEY can be added here
    // if you want to ensure they are not empty, even when hardcoded.

    // Load attempted users data at startup
    bot.context.attemptedUsers = await loadAttemptedUsers();

    bot.launch();
    console.log(`Bot started. Owner ID: ${OWNER_ID}. MCQs will be saved to ${MCQS_FILENAME}. Press Ctrl+C to stop.`);

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main();

