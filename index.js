const { Client, GatewayIntentBits, Partials } = require('discord.js');
const http = require('http');

// Membaca & membersihkan Environment Variables dari Railway
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const rawApiBase = process.env.API_BASE || "https://arnaru-ai.vercel.app";
const API_BASE = rawApiBase.replace(/\[|\]|\(|\)/g, '').trim();

// Dummy HTTP Server agar Railway Health Check tidak crash
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Aczellios AI Bot is active!');
}).listen(PORT, () => {
    console.log(`[!] HTTP Server berjalan di port ${PORT}`);
});

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

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const text = message.content.trim();
    const attachments = message.attachments;

    await message.channel.sendTyping();

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
        console.error("Terjadi Error:", error);
        message.reply(`Maaf, terjadi kesalahan sistem: ${error.message}`);
    }
});

async function handleChat(message, text, attachments) {
    const question = text || "Halo";
    let res;

    // Menggunakan model yang lebih stabil (gpt-4o atau gemini-2.5-flash)
    if (attachments.size > 0) {
        const formData = new FormData();
        formData.append("question", question);
        formData.append("model", "gpt-4o");
        formData.append("systemPrompt", "Nama kamu adalah Aczellios AI. Kamu WAJIB menjawab seluruh pertanyaan menggunakan Bahasa Indonesia yang ramah, sopan, dan santai.");
        
        let count = 0;
        for (const [id, attachment] of attachments) {
            if (count >= 9) break; 
            const response = await fetch(attachment.url);
            const blob = await response.blob();
            formData.append("files", blob, attachment.name);
            count++;
        }

        res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            body: formData
        });
    } else {
        const jsonBody = {
            question: question,
            model: "gpt-4o",
            systemPrompt: "Nama kamu adalah Aczellios AI. Kamu WAJIB menjawab seluruh pertanyaan menggunakan Bahasa Indonesia yang ramah, sopan, dan santai."
        };

        res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonBody)
        });
    }

    const streamData = await res.text();
    console.log("---- RAW RESPONSE DARI API ----");
    console.log(streamData);
    console.log("-------------------------------");

    const lines = streamData.split('\n');
    let fullAnswer = "";

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
        } catch (e) { }
    }

    // Jika gagal parse SSE, cek apakah API mengirimkan pesan error JSON biasa
    if (!fullAnswer.trim()) {
        try {
            const parsedError = JSON.parse(streamData);
            fullAnswer = `Gagal merespon dari API:\n\`\`\`json\n${JSON.stringify(parsedError, null, 2)}\n\`\`\``;
        } catch (e) {
            fullAnswer = `Gagal merespon. Mentahan dari server:\n\`\`\`\n${streamData.slice(0, 1500)}\n\`\`\``;
        }
    }

    if (fullAnswer.length > 2000) {
        const chunks = fullAnswer.match(/[\s\S]{1,1999}/g) || [];
        for (const chunk of chunks) {
            await message.channel.send(chunk);
        }
    } else {
        await message.reply(fullAnswer);
    }
}

async function handleImageGeneration(message, text, attachments) {
    const formData = new FormData();
    let prompt = text.replace(/^\/imagine|buatkan gambar|gambar/i, '').trim();
    if (!prompt) prompt = "A futuristic AI core shining with blue light";

    formData.append("prompt", prompt);
    formData.append("model", "flux-pro");

    if (attachments.size > 0) {
        let count = 0;
        for (const [id, attachment] of attachments) {
            if (count >= 5) break;
            const response = await fetch(attachment.url);
            const blob = await response.blob();
            formData.append("images", blob, attachment.name);
            count++;
        }
    }

    const res = await fetch(`${API_BASE}/api/image`, {
        method: 'POST',
        body: formData
    });

    const data = await res.text();
    let imageUrl = data;

    try {
        const parsed = JSON.parse(data);
        imageUrl = parsed.url || parsed.imageUrl || parsed.image || parsed.data?.[0]?.url || data;
    } catch (e) { }

    if (imageUrl.startsWith('http')) {
        await message.reply({ 
            content: `🎨 Berikut adalah hasil gambarmu untuk: **${prompt}**`, 
            files: [imageUrl] 
        });
    } else {
        await message.reply(`Gagal generate gambar. Respon server: \`\`\`\n${data.slice(0, 1500)}\n\`\`\``);
    }
}

client.login(TOKEN);
