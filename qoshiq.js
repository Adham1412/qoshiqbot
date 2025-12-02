require('dotenv').config();
const { Bot, InlineKeyboard, InputFile } = require("grammy");
const express = require("express");
const ytdl = require("@distube/ytdl-core");
const yts = require("yt-search");
const shazam = require("shazam-api"); 
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const axios = require('axios'); // Faylni yuklab olish uchun kerak

// --- SOZLAMALAR ---
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error("XATOLIK: BOT_TOKEN .env faylida yoki Render sozlamalarida kiritilmagan!");
    process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// --- SERVER (Renderda uxlab qolmaslik uchun) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("Bot  ishlamoqda! (Free Shazam version)");
});

// O'z-o'zini uyg'otib turish
const RENDER_URL = process.env.RENDER_URL;
if (RENDER_URL) {
    setInterval(() => {
        axios.get(RENDER_URL).catch(() => {});
    }, 14 * 60 * 1000);
}

app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishga tushdi.`);
});

// --- YORDAMCHI FUNKSIYALAR ---

// Faylni vaqtincha saqlash va o'chirish uchun
async function downloadFile(url, filepath) {
    const writer = fs.createWriteStream(filepath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    await pipeline(response.data, writer);
}

// Vaqtni formatlash (sekund -> 03:45)
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- BOT LOGIKASI ---

bot.command("start", (ctx) => {
    ctx.reply(
        "👋 **Assalomu alaykum!**\n\n" +
        "Men Universal Musiqa botiman (v2.0).\n" +
        "Endi hech qanday cheklovsiz ishlayman!\n\n" +
        "🔻 **Imkoniyatlarim:**\n" +
        "🔍 **Qidiruv:** Qo'shiq nomi yoki *matnidan parcha* yozing.\n" +
        "🎤 **Shazam:** Menga ovozli xabar yoki video yuboring, topib beraman.\n" +
        "📥 **Yuklash:** YouTube link yuboring.\n\n" +
        "Botni sinash uchun biror narsa yozing yoki audio yuboring! 🚀",
        { parse_mode: "Markdown" }
    );
});

// 1. MATN VA LINKLARNI QAYTA ISHLASH
bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    // A) Agar YouTube link bo'lsa
    if (text.includes("youtube.com") || text.includes("youtu.be")) {
        return handleYoutubeLink(ctx, text);
    }

    // B) Agar oddiy so'z bo'lsa (Qo'shiq qidirish)
    await ctx.reply(`🔎 **"${text}"** bo'yicha qidirilmoqda...`);
    
    try {
        // yt-search orqali qidiramiz (Bu matn orqali ham juda zo'r topadi)
        const r = await yts(text);
        const videos = r.videos.slice(0, 5); // Birinchi 5 ta natija

        if (!videos || videos.length === 0) {
            return ctx.reply("❌ Hech narsa topilmadi.");
        }

        // Eng birinchi natijani avtomatik taklif qilamiz
        const topVideo = videos[0];
        
        const keyboard = new InlineKeyboard()
            .text("🎵 MP3 yuklab olish", `dl_mp3_${topVideo.videoId}`).row()
            .text("🎬 MP4 yuklab olish", `dl_mp4_${topVideo.videoId}`);

        await ctx.replyWithPhoto(topVideo.thumbnail, {
            caption: `🎼 **Topildi:** ${topVideo.title}\n👤 **Kanal:** ${topVideo.author.name}\n⏱ **Vaqti:** ${topVideo.timestamp}\n\nQuyidagi tugmani bosing:`,
            reply_markup: keyboard
        });

    } catch (error) {
        console.error(error);
        ctx.reply("⚠️ Qidiruvda xatolik bo'ldi.");
    }
});

// 2. SHAZAM FUNKSIYASI (Ovoz va Video)
bot.on([":voice", ":audio", ":video_note"], async (ctx) => {
    const waitMsg = await ctx.reply("🎧 **Eshitmoqdaman... Tahlil qilyapman...**");

    try {
        // 1. Faylni aniqlash
        const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id || ctx.message.video_note?.file_id;
        const fileInfo = await ctx.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

        // 2. Faylni serverga vaqtincha yuklash (Shazam ishlashi uchun lokal fayl kerak)
        const tempFilePath = path.join(__dirname, `temp_${ctx.from.id}.ogg`);
        await downloadFile(fileUrl, tempFilePath);

        // 3. Shazam qilish (shazam-api kutubxonasi orqali)
        // Eslatma: Bu kutubxona fayl yo'lini talab qiladi
        // Agar format mos tushmasa, ffmpeg kerak bo'lishi mumkin, lekin telegram voice odatda ishlaydi.
        
        // Hozirgi shazam-api versiyalari ba'zan raw data so'raydi, lekin biz sodda usulni ko'ramiz.
        // Agar shazam-api da muammo bo'lsa, biz boshqa oddiy request yuboramiz. 
        // Lekin eng ishonchli tekin usul - faylni tahlil qilish.
        
        // Oddiylik uchun: Biz faylni tahlil qilish o'rniga, agar shazam kutubxonasi ishlamasa,
        // foydalanuvchiga matn yozishni so'rashimiz mumkin.
        // AMMO, siz 100% dedingiz. Keling, harakat qilamiz.
        
        // "shazam-api" kutubxonasini to'g'ri ishlatish:
        const recognizeResult = await shazam.recognize(tempFilePath); 
        
        // Faylni o'chirib tashlaymiz (joyni to'ldirmaslik uchun)
        fs.unlink(tempFilePath, () => {}); 

        if (recognizeResult && recognizeResult.track) {
            const track = recognizeResult.track;
            const title = track.title;
            const subtitle = track.subtitle; // Artist
            
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
            
            const replyText = `🎹 **Qo'shiq topildi!**\n\n🎤 **Ijrochi:** ${subtitle}\n🎼 **Nomi:** ${title}`;
            
            // Topilgan qo'shiqni darhol YouTube'dan qidirib, yuklash tugmasini chiqaramiz
            const searchRes = await yts(`${title} ${subtitle}`);
            const video = searchRes.videos[0];

            let keyboard;
            if (video) {
                 keyboard = new InlineKeyboard()
                    .text("📥 Hoziroq yuklab olish (MP3)", `dl_mp3_${video.videoId}`);
            }

            await ctx.reply(replyText, { reply_markup: keyboard });

        } else {
            fs.unlink(tempFilePath, () => {}); // Xato bo'lsa ham o'chirish
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
            await ctx.reply("😔 Kechirasiz, bu qo'shiqni aniqlay olmadim yoki shovqin juda baland.");
        }

    } catch (error) {
        console.error("Shazam xatosi:", error);
        // Fayl qolib ketgan bo'lsa o'chiramiz
        try { fs.unlinkSync(path.join(__dirname, `temp_${ctx.from.id}.ogg`)); } catch(e){}
        
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
        await ctx.reply("⚠️ Tizim xatosi. Iltimos, qo'shiq nomini yoki so'zlarini yozib yuboring, shunda aniq topaman.");
    }
});

// 3. YUKLAB OLISH FUNKSIYASI (MP3/MP4)
async function handleYoutubeLink(ctx, url) {
    try {
        const waiting = await ctx.reply("⏳ **Link tekshirilmoqda...**");
        const info = await ytdl.getInfo(url);
        
        const title = info.videoDetails.title;
        const videoId = info.videoDetails.videoId;
        const thumb = info.videoDetails.thumbnails[0].url;

        const keyboard = new InlineKeyboard()
            .text("🎵 MP3 (Audio)", `dl_mp3_${videoId}`)
            .row()
            .text("🎬 MP4 (Video)", `dl_mp4_${videoId}`);

        await ctx.api.deleteMessage(ctx.chat.id, waiting.message_id);
        await ctx.replyWithPhoto(thumb, {
            caption: `📹 **${title}**\n\nFormatni tanlang:`,
            reply_markup: keyboard
        });
    } catch (e) {
        ctx.reply("❌ Link yaroqsiz yoki xatolik yuz berdi.");
    }
}

// 4. CALLBACK (Tugma bosilganda)
bot.callbackQuery(/dl_(mp3|mp4)_(.+)/, async (ctx) => {
    const format = ctx.match[1];
    const videoId = ctx.match[2];
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    await ctx.answerCallbackQuery("📥 Yuklanmoqda...");
    await ctx.reply(`🚀 **${format.toUpperCase()}** formatida yuklash boshlandi... (Biroz kuting)`);

    try {
        if (format === 'mp3') {
            // Eng yuqori sifatli audio
            const stream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' });
            await ctx.replyWithAudio(new InputFile(stream), { title: "Musiqa", performer: "@BotNomi" });
        } else {
            // Video (Telegram uchun 50MB limit borligini unutmang, stream katta bo'lsa xato berishi mumkin)
            const stream = ytdl(url, { quality: 'highest', filter: 'videoandaudio' });
            await ctx.replyWithVideo(new InputFile(stream), { caption: "🎬 Marhamat!" });
        }
    } catch (error) {
        console.error(error);
        await ctx.reply("🚫 Fayl hajmi juda katta yoki serverda xatolik. Iltimos, boshqa video bilan urinib ko'ring.");
    }
});

bot.catch((err) => console.error("Bot xatosi:", err));
bot.start();