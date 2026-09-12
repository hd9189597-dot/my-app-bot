require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { Telegraf, Markup } = require('telegraf');

const app = express();
app.use(express.json());

// 1. Kết nối MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// Định nghĩa Cấu trúc dữ liệu Key (Schema)
const keySchema = new mongoose.Schema({
    license_key: { type: String, required: true, unique: true },
    tier: { type: String, default: 'premium' },
    duration_days: { type: Number, default: 30 },
    status: { type: String, default: 'active' }, 
    created_at: { type: Date, default: Date.now },
    used_by_device: { type: String, default: null }
});
const KeyModel = mongoose.model('LicenseKey', keySchema);

// 2. API Backend: Tạo Key
app.post('/api/admin/create-key', async (req, res) => {
    const secret = req.headers['authorization'];
    if (secret !== process.env.API_SECRET_KEY) {
        return res.status(403).json({ success: false, message: 'Sai mã bảo mật API!' });
    }

    try {
        const { tier, duration } = req.body;
        const newKey = `DK-${uuidv4().substring(0, 8).toUpperCase()}`;

        const keyDoc = new KeyModel({
            license_key: newKey,
            tier: tier || 'premium',
            duration_days: duration || 30
        });
        await keyDoc.save();

        res.json({ success: true, key: newKey });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi server khi tạo key' });
    }
});

// API kiểm tra Key từ App của bạn gửi lên
app.post('/api/client/validate-key', async (req, res) => {
    try {
        const { key, device_id } = req.body;
        const keyDoc = await KeyModel.findOne({ license_key: key });

        if (!keyDoc || keyDoc.status === 'revoked') {
            return res.json({ success: false, message: 'Key không tồn tại hoặc đã bị khóa!' });
        }

        if (keyDoc.used_by_device && keyDoc.used_by_device !== device_id) {
            return res.json({ success: false, message: 'Key đã được sử dụng trên thiết bị khác!' });
        }

        if (!keyDoc.used_by_device) {
            keyDoc.used_by_device = device_id;
            keyDoc.status = 'used';
            await keyDoc.save();
        }

        res.json({ success: true, message: 'Kích hoạt thành công!', tier: keyDoc.tier });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi kiểm tra key' });
    }
});

// 3. Khởi động Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.use((ctx, next) => {
    if (!ctx.chat || ctx.chat.id.toString() !== process.env.ADMIN_CHAT_ID) {
        return ctx.reply('⛔ Bạn không có quyền sử dụng bot này.');
    }
    return next();
});

bot.start((ctx) => {
    ctx.reply('🤖 Hệ thống Quản lý Key Drakon', Markup.keyboard([
        ['🔑 Tạo Key Trial (3 Ngày)', '💎 Tạo Key Vip (30 Ngày)']
    ]).resize());
});

bot.hears('🔑 Tạo Key Trial (3 Ngày)', async (ctx) => {
    try {
        ctx.reply('⏳ Đang tạo Key Trial...');
        const key = `DK-TRIAL-${uuidv4().substring(0, 6).toUpperCase()}`;
        
        const keyDoc = new KeyModel({ license_key: key, tier: 'trial', duration_days: 3 });
        await keyDoc.save();

        ctx.replyWithMarkdown(`✅ **Tạo Key Trial thành công!**\n\n🔑 Key: \`${key}\`\n📅 Thời hạn: 3 ngày`, 
            Markup.inlineKeyboard([Markup.button.copy('📋 Copy Key', key)])
        );
    } catch (e) {
        ctx.reply('❌ Lỗi tạo key!');
    }
});

bot.hears('💎 Tạo Key Vip (30 Ngày)', async (ctx) => {
    try {
        ctx.reply('⏳ Đang tạo Key VIP...');
        const key = `DK-VIP-${uuidv4().substring(0, 6).toUpperCase()}`;
        
        const keyDoc = new KeyModel({ license_key: key, tier: 'vip', duration_days: 30 });
        await keyDoc.save();

        ctx.replyWithMarkdown(`💎 **Tạo Key VIP thành công!**\n\n🔑 Key: \`${key}\`\n📅 Thời hạn: 30 ngày`, 
            Markup.inlineKeyboard([Markup.button.copy('📋 Copy Key', key)])
        );
    } catch (e) {
        ctx.reply('❌ Lỗi tạo key!');
    }
});

bot.launch();
console.log('🤖 Telegram Bot đã khởi động!');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Server đang chạy tại cổng ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
