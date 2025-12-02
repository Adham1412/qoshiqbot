require('dotenv').config();
const { Bot, InlineKeyboard, InputFile } = require("grammy");
const express = require("express");
const ytdl = require("@distube/ytdl-core");
const yts = require("yt-search");
const shazam = require("shazam-api");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const axios = require('axios');

// --- SOZLAMALAR ---
const BOT_TOKEN = process.env.BOT_TOKEN;

// Token tekshiruvi
if (!BOT_TOKEN) {
    console.error("❌ XATOLIK: BOT_TOKEN topilmadi! .env fayl yoki Render Environment Variables ni tekshiring.");
    process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// --- SERVER (Renderda uxlab qolmaslik uchun) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("🤖 Bot ishlamoqda! (Status: Active)");
});

// O'z-o'zini uyg'otib turish (Ping)
const RENDER_URL = process.env.RENDER_URL;
if (RENDER_URL) {
    setInterval(() => {
        console.log(`🔄 Ping yuborilmoqda: ${RENDER_URL}`);
        axios.get(RENDER_URL).catch((err) => console.error("Ping xatosi:", err.message));
    }, 14 * 60 * 1000); // Har 14 daqiqada
}

app.listen(PORT, () => {
    console.log(`🚀 Server ${PORT}-portda ishga tushdi.`);
});

// --- YORDAMCHI FUNKSIYALAR ---

// Faylni vaqtincha yuklab olish
async function downloadFile(url, filepath) {
    const writer = fs.createWriteStream(filepath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    await pipeline(response.data, writer);
}

// Vaqtinchalik faylni o'chirish
function deleteFile(filepath) {
    fs.unlink(filepath, (err) => {
        if (err) console.error("Fayl o'chirishda xato:", err);
    });
}

// --- BOT LOGIKASI ---

bot.command("start", (ctx) => {
    ctx.reply(
        "👋 **Assalomu alaykum!**\n\n" +
        "Men Universal Musiqa botiman.\n\n" +
        "🔻 **Imkoniyatlarim:**\n" +
        "🔍 **Qidiruv:** Qo'shiq nomini yozing.\n" +
        "🎤 **Shazam:** Ovozli xabar yoki video yuboring.\n" +
        "📥 **Yuklash:** YouTube link yuboring.\n\n" +
        "🚀 Boshlash uchun biror narsa yozing!",
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

    // B) Oddiy qidiruv
    const loadingMsg = await ctx.reply(`🔎 **"${text}"** qidirilmoqda...`);
    
    try {
        const r = await yts(text);
        const videos = r.videos.slice(0, 1); // Eng birinchi natijani olamiz

        if (!videos || videos.length === 0) {
            await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
            return ctx.reply("❌ Hech narsa topilmadi.");
        }

        const topVideo = videos[0];
        
        const keyboard = new InlineKeyboard()
            .text("🎵 MP3 yuklab olish", `dl_mp3_${topVideo.videoId}`).row()
            .text("🎬 MP4 yuklab olish", `dl_mp4_${topVideo.videoId}`);

        await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
        
        await ctx.replyWithPhoto(topVideo.thumbnail, {
            caption: `🎼 **Topildi:** ${topVideo.title}\n👤 **Kanal:** ${topVideo.author.name}\n⏱ **Vaqti:** ${topVideo.timestamp}\n🔗 [YouTube'da ko'rish](${topVideo.url})`,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });

    } catch (error) {
        console.error(error);
        await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
        ctx.reply("⚠️ Qidiruvda xatolik bo'ldi.");
    }
});

// 2. SHAZAM FUNKSIYASI
bot.on([":voice", ":audio", ":video_note"], async (ctx) => {
    const waitMsg = await ctx.reply("🎧 **Eshitmoqdaman... Tahlil qilyapman...**");

    const tempFileName = `temp_${ctx.from.id}_${Date.now()}.ogg`;
    const tempFilePath = path.join(__dirname, tempFileName);

    try {
        // Fayl ID sini olish
        const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id || ctx.message.video_note?.file_id;
        const fileInfo = await ctx.api.getFile(fileId);
        
        // Agar fayl juda katta bo'lsa (20MB dan oshsa)
        if (fileInfo.file_size > 20 * 1024 * 1024) {
             await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
             return ctx.reply("⚠️ Fayl juda katta. Iltimos, kichikroq fayl yuboring.");
        }

        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

        // Serverga yuklab olish
        await downloadFile(fileUrl, tempFilePath);

        // Shazam qilish
        const recognizeResult = await shazam.recognize(tempFilePath); 
        
        // Ishlatib bo'lgach o'chiramiz
        deleteFile(tempFilePath);

        if (recognizeResult && recognizeResult.track) {
            const track = recognizeResult.track;
            const title = track.title;
            const subtitle = track.subtitle;
            const cover = track.images?.coverart || "";

            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
            
            // Qidiruv tugmasini qo'shamiz
            const searchKeyboard = new InlineKeyboard().text("📥 Yuklab olish (Qidiruv)", `search_shazam_${title} ${subtitle}`);

            let captionText = `🎹 **Qo'shiq topildi!**\n\n🎤 **Ijrochi:** ${subtitle}\n🎼 **Nomi:** ${title}`;
            
            if(cover) {
                await ctx.replyWithPhoto(cover, { caption: captionText, parse_mode: "Markdown", reply_markup: searchKeyboard });
            } else {
                await ctx.reply(captionText, { parse_mode: "Markdown", reply_markup: searchKeyboard });
            }

        } else {
            deleteFile(tempFilePath);
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
            await ctx.reply("😔 Kechirasiz, bu qo'shiqni aniqlay olmadim.");
        }

    } catch (error) {
        console.error("Shazam xatosi:", error);
        deleteFile(tempFilePath); // Xato bo'lsa ham o'chiramiz
        
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        await ctx.reply("⚠️ Tizim xatosi yoki fayl formati qo'llab quvvatlanmadi.");
    }
});

// Shazamdan keyin avtomatik qidirish uchun callback
bot.callbackQuery(/search_shazam_(.+)/, async (ctx) => {
    const query = ctx.match[1];
    await ctx.answerCallbackQuery("🔍 Qidirilmoqda...");
    
    // Matn qidiruv funksiyasini chaqiramiz (simulyatsiya)
    // Lekin kodni takrorlamaslik uchun to'g'ridan-to'g'ri yts ishlatamiz
    try {
        const r = await yts(query);
        const video = r.videos[0];
        if(video) {
             const keyboard = new InlineKeyboard()
            .text("🎵 MP3 yuklab olish", `dl_mp3_${video.videoId}`);
            
            await ctx.replyWithPhoto(video.thumbnail, {
                caption: `🎼 **Shazam natijasi:** ${video.title}\n\nYuklash uchun bosing:`,
                reply_markup: keyboard
            });
        } else {
            ctx.reply("YouTube dan topilmadi.");
        }
    } catch (e) {
        ctx.reply("Xatolik bo'ldi.");
    }
});


// 3. YUKLAB OLISH FUNKSIYASI
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
        console.error(e);
        ctx.reply("❌ Link yaroqsiz yoki YouTube blokladi.");
    }
}

// 4. CALLBACK (Yuklash jarayoni)
bot.callbackQuery(/dl_(mp3|mp4)_(.+)/, async (ctx) => {
    const format = ctx.match[1];
    const videoId = ctx.match[2];
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    await ctx.answerCallbackQuery("📥 Yuklanmoqda...");
    const msg = await ctx.reply(`🚀 **${format.toUpperCase()}** formatida yuklash boshlandi...`);

    try {
        if (format === 'mp3') {
            // Audio yuklash
            const stream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' });
            await ctx.replyWithAudio(new InputFile(stream), { title: "Musiqa", performer: "@BotNomi" });
        } else {
            // Video yuklash
            const stream = ytdl(url, { quality: '18' }); // 18 - bu ko'pincha 360p (video+audio birga). Yuqori sifat uchun ffmpeg kerak.
            await ctx.replyWithVideo(new InputFile(stream), { caption: "🎬 Marhamat!" });
        }
        await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});

    } catch (error) {
        console.error(error);
        await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
        await ctx.reply("🚫 Fayl hajmi juda katta yoki serverda xatolik. (YouTube IP ni bloklagan bo'lishi mumkin)");
    }
});

// Xatolarni ushlash
bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    console.error(err.error);
});

// Botni ishga tushirish
bot.start();
