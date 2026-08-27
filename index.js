const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Konfigurasi Bot & API
const TOKEN = "MTU0MDMzOTUyNDQ4MjEwNTM4NA.Gd42Hd.WYsSxVaMD5FgPx5CHWABnZh5X_cxA-nz6MKwYg";
const TARGET_CHANNEL_ID = "1540339804695306344";
const API_BASE = "https://arnaru-ai.vercel.app";

// Penyimpanan Conversation ID untuk menyimpan riwayat topik percakapan
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
    // Abaikan pesan dari bot lain
    if (message.author.bot) return;
    
    // Batasi respon hanya di channel spesifik
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const text = message.content.trim();
    const attachments = message.attachments;

    // Fitur Reset Memori / Topik Percakapan
    if (text.toLowerCase() === '/reset' || text.toLowerCase() === 'reset') {
        activeConversations.delete(message.channel.id);
        return message.reply("🧹 **Memori percakapan telah direset!** Aczellios AI siap memulai topik baru.");
    }

    // Tampilkan indikator "Bot is typing..."
    await message.channel.sendTyping();

    // Cek apakah user meminta pembuat gambar
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

// Fungsi untuk Chat / Tanya Jawab / Baca File dengan Memori Topik
async function handleChat(message, text, attachments) {
    const formData = new FormData();
    const question = text || "Tolong jelaskan gambar/file ini dengan detail.";
    const channelId = message.channel.id;
    
    formData.append("question", question);
    formData.append("model", "gpt-5");
    formData.append("systemPrompt", "Nama kamu adalah Aczellios AI. Kamu WAJIB menjawab seluruh pertanyaan menggunakan Bahasa Indonesia yang ramah, sopan, dan santai.");

    // Kirim conversationId jika sudah ada sesi percakapan sebelumnya
    if (activeConversations.has(channelId)) {
        formData.append("conversationId", activeConversations.get(channelId));
    }

    // Kirim file jika ada attachment (Maksimal 9 file)
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

    // Baca dan parse format SSE (data: {"answer": "...", "conversationId": "..."})
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
            // Simpan conversationId terbaru dari API
            if (parsed.conversationId) {
                newConversationId = parsed.conversationId;
            }
        } catch (e) {
            // Abaikan potongan JSON yang tidak lengkap
        }
    }

    // Update penyimpanan conversationId
    if (newConversationId) {
        activeConversations.set(channelId, newConversationId);
    }

    if (!fullAnswer.trim()) {
        fullAnswer = "Maaf, Aczellios AI tidak memberikan respon.";
    }

    // Split pesan jika melebihi batas 2000 karakter Discord
    if (fullAnswer.length > 2000) {
        const chunks = fullAnswer.match(/[\s\S]{1,1999}/g) || [];
        for (const chunk of chunks) {
            await message.channel.send(chunk);
        }
    } else {
        await message.reply(fullAnswer);
    }
}

// Fungsi untuk Generate Gambar / Image to Image
async function handleImageGeneration(message, text, attachments) {
    const formData = new FormData();
    const channelId = message.channel.id;
    
    let prompt = text.replace(/^\/imagine|buatkan gambar|gambar/i, '').trim();
    if (!prompt) prompt = "A futuristic AI core shining with blue light";

    formData.append("prompt", prompt);
    formData.append("model", "flux-pro");

    // Sertakan conversationId juga jika ada
    if (activeConversations.has(channelId)) {
        formData.append("conversationId", activeConversations.get(channelId));
    }

    // Kirim file referensi jika ada (Image to Image, Maksimal 5 file)
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