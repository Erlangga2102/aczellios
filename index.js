const { Client, GatewayIntentBits, Partials } = require('discord.js');
const http = require('http');

// Membaca konfigurasi dari Environment Variables Railway
const TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const API_BASE = process.env.API_BASE || "https://arnaru-ai.vercel.app";

// Membuat dummy HTTP Server untuk Railway Healthcheck
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Aczellios AI Bot is active!');
}).listen(PORT, () => {
    console.log(`[!] HTTP Server berjalan di port ${PORT}`);
});

// Penyimpanan Conversation ID untuk riwayat topik percakapan
const activeConversations = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel]
});

client.on('ready', () => {
    console.log(`[!] Berhasil login sebagai ${client.user.tag} (Aczellios AI)`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const text = message.content.trim();
    const attachments = message.attachments;

    if (text.toLowerCase() === '/reset' || text.toLowerCase() === 'reset') {
        activeConversations.delete(message.channel.id);
        return message.reply("🧹 **Memori percakapan telah direset!** Aczellios AI siap memulai topik baru.");
    }

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
        message.reply("Maaf, terjadi kesalahan saat menghubungkan ke server Aczellios AI.");
    }
});

async function handleChat(message, text, attachments) {
    const formData = new FormData();
    const question = text || "Tolong jelaskan gambar/file ini dengan detail.";
    const channelId = message.channel.id;
    
    formData.append("question", question);
    formData.append("model", "gpt-5");
    formData.append("systemPrompt", "Nama kamu adalah Aczellios AI. Kamu WAJIB menjawab seluruh pertanyaan menggunakan Bahasa Indonesia yang ramah, sopan, dan santai.");

    if (activeConversations.has(channelId)) {
        formData.append("conversationId", activeConversations.get(channelId));
    }

    if (attachments.size > 0) {
        let count = 0;
        for (const [id, attachment] of attachments) {
            if (count >= 9) break; 
            const response = await fetch(attachment.url);
            const blob = await response.blob();
            formData.append("files", blob, attachment.name);
            count++;
        }
    }

    const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        body: formData
    });

    if (!res.ok) throw new Error(`API Error Status: ${res.status}`);

    const streamData = await res.text();
    const lines = streamData.split('\n');
    let fullAnswer = "";
    let newConversationId = null;

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
            if (parsed.conversationId) {
                newConversationId = parsed.conversationId;
            }
        } catch (e) { }
    }

    if (newConversationId) {
        activeConversations.set(channelId, newConversationId);
    }

    if (!fullAnswer.trim()) {
        fullAnswer = "Maaf, Aczellios AI tidak memberikan respon.";
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
    const channelId = message.channel.id;
    
    let prompt = text.replace(/^\/imagine|buatkan gambar|gambar/i, '').trim();
    if (!prompt) prompt = "A futuristic AI core shining with blue light";

    formData.append("prompt", prompt);
    formData.append("model", "flux-pro");

    if (activeConversations.has(channelId)) {
        formData.append("conversationId", activeConversations.get(channelId));
    }

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

    if (!res.ok) throw new Error(`API Error Status: ${res.status}`);

    const data = await res.text();
    let imageUrl = data;

    try {
        const parsed = JSON.parse(data);
        imageUrl = parsed.url || parsed.imageUrl || parsed.image || parsed.data?.[0]?.url || data;
        if (parsed.conversationId) {
            activeConversations.set(channelId, parsed.conversationId);
        }
    } catch (e) { }

    if (imageUrl.startsWith('http')) {
        await message.reply({ 
            content: `🎨 Berikut adalah hasil gambarmu untuk: **${prompt}**`, 
            files: [imageUrl] 
        });
    } else {
        await message.reply("Gambar berhasil dibuat, namun format balasan dari server tidak dapat dibaca langsung oleh Discord.");
        console.log("Raw Image Response:", imageUrl);
    }
}

client.login(TOKEN);
