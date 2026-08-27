const { Client, GatewayIntentBits, Partials, AttachmentBuilder } = require('discord.js');
const http = require('http');

// 1. Membaca & Membersihkan Environment Variables
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const rawApiBase = process.env.API_BASE || "https://arnaru-ai.vercel.app";
const API_BASE = rawApiBase.replace(/\[|\]|\(|\)/g, '').trim();

if (!TOKEN || !TARGET_CHANNEL_ID) {
    console.error("[ERROR] DISCORD_TOKEN dan TARGET_CHANNEL_ID wajib diisi di Variables Railway!");
}

// 2. Dummy HTTP Server untuk Railway Healthcheck
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Aczellios AI Bot is active and running!');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`[!] HTTP Server berjalan di port ${PORT}`);
});

// 3. Setup Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel]
});

client.once('clientReady', () => {
    console.log(`[!] Berhasil login sebagai ${client.user.tag} (Aczellios AI)`);
});

// 4. Handler Pesan Masuk
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const text = message.content.trim();
    const attachments = message.attachments;

    try {
        await message.channel.sendTyping();
    } catch (e) {
        console.warn("Gagal mengirim indikator typing:", e.message);
    }

    const isImageRequest = text.toLowerCase().startsWith('/imagine') || 
                           text.toLowerCase().startsWith('buatkan gambar') ||
                           text.toLowerCase().startsWith('gambar');

    try {
        if (isImageRequest) {
            await handleImageGeneration(message, text, attachments);
        } else {
            await handleChat(message, text, attachments);
        }
    } catch (error) {
        console.error("[ERROR Handler]:", error);
        await sendResponseSafely(message, `❌ Terjadi kesalahan sistem: ${error.message}`);
    }
});

/**
 * Helper: Mengirim pesan teks biasa jika <= 2000 karakter,
 * atau mengirimkan sebagai file .txt jika > 2000 karakter.
 */
async function sendResponseSafely(message, contentText) {
    if (!contentText || !contentText.trim()) {
        contentText = "Maaf, tidak ada respon yang dihasilkan dari AI.";
    }

    if (contentText.length > 2000) {
        const buffer = Buffer.from(contentText, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: 'respon-aczellios.txt' });
        
        await message.reply({
            content: `📄 **Respon terlalu panjang (${contentText.length} karakter).** Hasil lengkap telah dikirimkan dalam bentuk file teks di bawah ini:`,
            files: [attachment]
        });
    } else {
        await message.reply(contentText);
    }
}

// Handler untuk Chat AI / Tanya Jawab / Baca File
async function handleChat(message, text, attachments) {
    const question = text || "Jelaskan gambar/file ini";
    let res;

    // Jika pengguna mengirimkan file/gambar
    if (attachments.size > 0) {
        const formData = new FormData();
        formData.append("question", question);
        formData.append("model", "gpt-5.6-sol");
        formData.append("systemPrompt", "Nama kamu adalah Aczellios AI. Jawablah seluruh pertanyaan menggunakan Bahasa Indonesia yang ramah, sopan, dan jelas.");

        let count = 0;
        for (const [, attachment] of attachments) {
            if (count >= 9) break;
            try {
                const imgRes = await fetch(attachment.url);
                if (imgRes.ok) {
                    const blob = await imgRes.blob();
                    formData.append("files", blob, attachment.name || `file_${count}.png`);
                    count++;
                }
            } catch (err) {
                console.error(`Gagal mengunduh attachment ${attachment.name}:`, err.message);
            }
        }

        res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            body: formData
        });
    } else {
        // Jika hanya pesan teks biasa
        const jsonBody = {
            question: question,
            model: "gpt-5.6-sol",
            systemPrompt: "Nama kamu adalah Aczellios AI. Jawablah seluruh pertanyaan menggunakan Bahasa Indonesia yang ramah, sopan, dan jelas."
        };

        res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonBody)
        });
    }

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Server API merespon dengan HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const streamData = await res.text();
    const lines = streamData.split('\n');
    let fullAnswer = "";

    // Parse format SSE (Server-Sent Events)
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        
        const jsonStr = trimmed.replace(/^data:\s*/, '');
        if (jsonStr === '[DONE]') break;

        try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.answer) {
                fullAnswer += parsed.answer;
            }
        } catch (e) {
            // Abaikan potongan SSE yang belum lengkap
        }
    }

    if (!fullAnswer.trim()) {
        try {
            const parsedError = JSON.parse(streamData);
            if (parsedError.answer) {
                fullAnswer = parsedError.answer;
            } else if (parsedError.error || parsedError.message) {
                fullAnswer = `⚠️ **Pesan Server:** ${parsedError.error || parsedError.message}`;
            } else {
                fullAnswer = JSON.stringify(parsedError, null, 2);
            }
        } catch (e) {
            fullAnswer = streamData.trim() || "Tidak ada respon dari server AI.";
        }
    }

    await sendResponseSafely(message, fullAnswer);
}

// Handler untuk Generate Gambar
async function handleImageGeneration(message, text, attachments) {
    const formData = new FormData();
    let prompt = text.replace(/^\/imagine|buatkan gambar|gambar/i, '').trim();
    if (!prompt) prompt = "A futuristic AI core shining with vibrant blue light";

    formData.append("prompt", prompt);
    formData.append("model", "flux-pro");

    if (attachments.size > 0) {
        let count = 0;
        for (const [, attachment] of attachments) {
            if (count >= 5) break;
            try {
                const imgRes = await fetch(attachment.url);
                if (imgRes.ok) {
                    const blob = await imgRes.blob();
                    formData.append("images", blob, attachment.name || `image_${count}.png`);
                    count++;
                }
            } catch (err) {
                console.error(`Gagal mengunduh gambar referensi ${attachment.name}:`, err.message);
            }
        }
    }

    const res = await fetch(`${API_BASE}/api/image`, {
        method: 'POST',
        body: formData
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Gagal generate gambar (HTTP ${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.text();
    let imageUrl = data;

    try {
        const parsed = JSON.parse(data);
        imageUrl = parsed.url || parsed.imageUrl || parsed.image || parsed.data?.[0]?.url || data;
    } catch (e) { }

    imageUrl = imageUrl.trim();

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        await message.reply({ 
            content: `🎨 Berikut adalah hasil gambarmu untuk: **${prompt}**`, 
            files: [imageUrl] 
        });
    } else {
        await sendResponseSafely(message, `Gambar berhasil diproses tetapi respon server non-URL:\n\`\`\`\n${imageUrl.slice(0, 1500)}\n\`\`\``);
    }
}

// Login Bot
if (TOKEN) {
    client.login(TOKEN);
} else {
    console.error("[CRITICAL] DISCORD_TOKEN tidak ditemukan!");
}
