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
  .catch((err) => console.error('❌ Lỗi kết nối MongoDB:', err));

// Định nghĩa cấu trúc dữ liệu Key (Schema)
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
app.post('/admin/create-key', async (req, res) => {
  try {
    const secret = req.headers['authorization'];
    if (secret !== process.env.API_SECRET_KEY) {
      return res.status(403).json({ success: false, message: 'Sai mã bảo mật API' });
    }

    const tier = req.body.tier || 'premium';
    const duration_days = req.body.duration_days || 30;
    const newKey = `DK-${uuidv4().substring(0, 8).toUpperCase()}`;

    const newDoc = new KeyModel({
      license_key: newKey,
      tier: tier,
      duration_days: duration_days
    });

    await newDoc.save();
    res.json({ success: true, key: newKey });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi server khi tạo key' });
  }
});

// API kiểm tra key từ App của bạn gửi lên
app.post('/api/client/validate-key', async (req, res) => {
  try {
    const { key, device_id } = req.body;
    const keyDoc = await KeyModel.findOne({ license_key: key });

    if (!keyDoc || keyDoc.status === 'revoked') {
      return res.json({ success: false, message: 'Key không tồn tại hoặc đã bị khóa' });
    }

    if (keyDoc.used_by_device && keyDoc.used_by_device !== device_id) {
      return res.json({ success: false, message: 'Key đã được sử dụng trên thiết bị khác' });
    }

    if (!keyDoc.used_by_device) {
      keyDoc.used_by_device = device_id;
      keyDoc.status = 'used';
      await keyDoc.save();
    }

    res.json({ success: true, message: 'Kích hoạt thành công', tier: keyDoc.tier });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi kiểm tra key' });
  }
});

// 3. Khởi động Telegram Bot
const BOT_TOKEN = "8759241568:AAGMuhpA4rrydfk3y-9yNKfx98Qzm6KYUbs";
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID; // Có thể để trống nếu không chặn quyền

const bot = new Telegraf(BOT_TOKEN);

bot.use((ctx, next) => {
  if (ADMIN_CHAT_ID && ctx.chat.id.toString() !== ADMIN_CHAT_ID) {
    return ctx.reply('⛔ Bạn không có quyền sử dụng bot này.');
  }
  return next();
});

bot.start((ctx) => {
  ctx.reply('🤖 Hệ thống Quản lý Key Drakon - Chọn loại key cần tạo:', Markup.keyboard([
    ['🔑 Tạo Key 1 Ngày', '🔑 Tạo Key 3 Ngày'],
    ['🔑 Tạo Key 7 Ngày', '⭐ Tạo Key 1 Tháng'],
    ['💎 Tạo Key 100 Năm']
  ]).resize());
});

// Hàm helper để tạo key nhanh gọn
const handleCreateKey = async (ctx, prefix, tier, days, label) => {
  try {
    const key = `${prefix}-${uuidv4().substring(0, 8).toUpperCase()}`;
    const newDoc = new KeyModel({ license_key: key, tier: tier, duration_days: days });
    await newDoc.save();

    ctx.replyWithMarkdown(`✨ *Tạo Key ${label} thành công!*\n\n` + `🔑 Key: \`${key}\``, 
      Markup.inlineKeyboard([Markup.button.copy('📋 Copy Key', key)])
    );
  } catch (err) {
    ctx.reply('❌ Lỗi tạo Key!');
  }
};

bot.hears('🔑 Tạo Key 1 Ngày', (ctx) => handleCreateKey(ctx, 'DK-1D', '1day', 1, '1 Ngày'));
bot.hears('🔑 Tạo Key 3 Ngày', (ctx) => handleCreateKey(ctx, 'DK-3D', '3day', 3, '3 Ngày'));
bot.hears('🔑 Tạo Key 7 Ngày', (ctx) => handleCreateKey(ctx, 'DK-7D', '7day', 7, '7 Ngày'));
bot.hears('⭐ Tạo Key 1 Tháng', (ctx) => handleCreateKey(ctx, 'DK-1M', '1month', 30, '1 Tháng'));
bot.hears('💎 Tạo Key 100 Năm', (ctx) => handleCreateKey(ctx, 'DK-100Y', 'lifetime', 36500, '100 Năm'));

bot.launch();
console.log('🤖 Telegram Bot đã khởi động!');

// Khởi chạy Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại cổng ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
