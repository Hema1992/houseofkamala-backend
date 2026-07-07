const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');


const path = require('path');
const upload = require('./upload-middleware');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const separator = trimmed.indexOf('=');
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
}

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:4200,http://127.0.0.1:4200,http://houseofkamala.com,https://houseofkamala.com,http://www.houseofkamala.com,https://www.houseofkamala.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const publicApiUrl = (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const port = Number(process.env.PORT || 3000);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));
app.use(bodyParser.json());
// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const getMongoUriInfo = (uri) => {
  if (!uri) return { configured: false };
  try {
    const withoutCredentials = uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//<user>:<password>@');
    const hostPart = withoutCredentials.split('@').pop()?.split('/')[0] || '';
    const database = withoutCredentials.split('/')[3]?.split('?')[0] || '';
    return {
      configured: true,
      scheme: uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : uri.startsWith('mongodb://') ? 'mongodb' : 'unknown',
      host: hostPart,
      database,
      preview: withoutCredentials,
    };
  } catch (err) {
    return { configured: true, parseError: err.message };
  }
};

app.get('/', (req, res) => {
  res.json({
    name: 'House of Kamala API',
    status: 'ok',
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState,
  });
});

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/shopdb';
console.log('MongoDB URI info:', getMongoUriInfo(mongoUri));

mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 15000,
}).catch((err) => {
  console.error('MongoDB connection failed:', {
    name: err.name,
    code: err.code,
    message: err.message,
  });
});

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected');
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', {
    name: err.name,
    code: err.code,
    message: err.message,
  });
});

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },
  name: String,
  category: String,
  fabric: String,
  color: String,
  price: Number,
  mrp: Number,
  stock: Number,
  outOfStock: Boolean,
  rating: Number,
  badge: String,
  description: String,
  details: String,
  materialsCare: String,
  shippingReturns: String,
  imageUrl: String,
  images: [String],
});
const Product = mongoose.model('Product', productSchema);

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  salt: { type: String, required: true },
  role: { type: String, enum: ['admin', 'customer'], default: 'customer' },
  phone: String,
  address: {
    name: String,
    phone: String,
    line1: String,
    city: String,
    state: String,
    pincode: String,
  },
  resetCodeHash: String,
  resetCodeExpiresAt: Date,
  resetVerifiedUntil: Date,
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const userStateSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  cartItems: [{
    productId: String,
    quantity: Number,
  }],
  wishlistProductIds: [String],
}, { timestamps: true });
const UserState = mongoose.model('UserState', userStateSchema);

const orderItemSchema = new mongoose.Schema({
  product: { type: Object, required: true },
  quantity: { type: Number, required: true },
}, { _id: false });

const addressSchema = new mongoose.Schema({
  name: String,
  phone: String,
  line1: String,
  city: String,
  state: String,
  pincode: String,
}, { _id: false });

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  customerName: String,
  customerEmail: String,
  date: String,
  items: [orderItemSchema],
  total: Number,
  status: { type: String, enum: ['Placed', 'Packed', 'Shipped', 'Delivered'], default: 'Placed' },
  paymentMode: { type: String, enum: ['Razorpay', 'COD'], required: true },
  address: addressSchema,
}, { timestamps: true });
const Order = mongoose.model('Order', orderSchema);

const hashPassword = (password, salt) => {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
};

const hashResetCode = (code) => {
  return crypto.createHash('sha256').update(code).digest('hex');
};

async function sendResetEmail(to, code) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.log(`Password reset code for ${to}: ${code}`);
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: 'Your House of Kamala password reset code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
  });

  return true;
}

const toPublicUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
});

const toUserProfile = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone || user.address?.phone || '',
  address: user.address || undefined,
});

const razorpayRequest = (method, apiPath, payload) => {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return Promise.reject(new Error('Razorpay API keys are not configured'));
  }

  const body = payload ? JSON.stringify(payload) : undefined;
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

  return new Promise((resolve, reject) => {
    const request = require('https').request({
      hostname: 'api.razorpay.com',
      path: apiPath,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let parsed = {};
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch (err) {
          reject(new Error('Razorpay returned an invalid response'));
          return;
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(parsed);
          return;
        }
        reject(new Error(parsed?.error?.description || parsed?.message || 'Razorpay request failed'));
      });
    });

    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
};

async function ensureDefaultAdmin() {
  const email = 'kamalahouseofsaree@gmail.com';
  const existing = await User.findOne({ email });
  if (existing) return;

  const salt = crypto.randomBytes(16).toString('hex');
  await User.create({
    name: 'Vastra Admin',
    email,
    salt,
    passwordHash: hashPassword('admin123', salt),
    role: 'admin',
  });
}

mongoose.connection.once('open', () => {
  ensureDefaultAdmin().catch((err) => console.error('Failed to create default admin:', err));
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const user = await User.create({
      name,
      email: normalizedEmail,
      salt,
      passwordHash: hashPassword(password, salt),
      role: 'customer',
    });

    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: String(email || '').toLowerCase().trim() });
    if (!user || hashPassword(password || '', user.salt) !== user.passwordHash) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Login failed' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    user.resetCodeHash = hashResetCode(code);
    user.resetCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    user.resetVerifiedUntil = undefined;
    await user.save();

    const emailSent = await sendResetEmail(user.email, code);
    res.json({
      message: emailSent ? 'Verification code sent to your email' : 'Verification code generated for local development',
      emailSent,
      devCode: emailSent ? undefined : code,
    });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not send reset code' });
  }
});

app.post('/api/auth/verify-reset-code', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const code = String(req.body.code || '').trim();
    const user = await User.findOne({ email });
    if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt) {
      return res.status(400).json({ message: 'Please request a new verification code' });
    }
    if (user.resetCodeExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: 'Verification code expired' });
    }
    if (hashResetCode(code) !== user.resetCodeHash) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    user.resetVerifiedUntil = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    res.json({ message: 'Verification code confirmed' });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not verify reset code' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email });
    const codeMatches = user?.resetCodeHash && hashResetCode(code) === user.resetCodeHash;
    const isVerified = user?.resetVerifiedUntil && user.resetVerifiedUntil.getTime() >= Date.now();
    const codeIsFresh = user?.resetCodeExpiresAt && user.resetCodeExpiresAt.getTime() >= Date.now();
    if (!user || !codeMatches || !isVerified || !codeIsFresh) {
      return res.status(400).json({ message: 'Reset verification is invalid or expired' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passwordHash = hashPassword(password, salt);
    user.resetCodeHash = undefined;
    user.resetCodeExpiresAt = undefined;
    user.resetVerifiedUntil = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not reset password' });
  }
});

app.get('/api/users/:id/profile', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(toUserProfile(user));
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not load profile' });
  }
});

app.patch('/api/users/:id/profile', async (req, res) => {
  try {
    const updates = {};
    if (req.body.name) updates.name = String(req.body.name).trim();
    if (req.body.phone !== undefined) updates.phone = String(req.body.phone || '').trim();
    if (req.body.address) {
      updates.address = {
        name: String(req.body.address.name || req.body.name || '').trim(),
        phone: String(req.body.address.phone || req.body.phone || '').trim(),
        line1: String(req.body.address.line1 || '').trim(),
        city: String(req.body.address.city || '').trim(),
        state: String(req.body.address.state || '').trim(),
        pincode: String(req.body.address.pincode || '').trim(),
      };
    }

    const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(toUserProfile(user));
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not update profile' });
  }
});

app.get('/api/user-state/:userId', async (req, res) => {
  try {
    const state = await UserState.findOne({ userId: req.params.userId }) || { cartItems: [], wishlistProductIds: [] };
    const cartProductIds = state.cartItems.map((item) => item.productId);
    const wishlistProductIds = state.wishlistProductIds || [];
    const products = await Product.find({ id: { $in: Array.from(new Set([...cartProductIds, ...wishlistProductIds])) } });
    const productMap = new Map(products.map((product) => [product.id, product.toObject()]));
    const validWishlistProductIds = wishlistProductIds.filter((productId) => productMap.has(productId));
    if (state._id && validWishlistProductIds.length !== wishlistProductIds.length) {
      state.wishlistProductIds = validWishlistProductIds;
      await state.save();
    }

    res.json({
      cartItems: state.cartItems
        .map((item) => ({ product: productMap.get(item.productId), quantity: item.quantity }))
        .filter((item) => item.product),
      wishlistProductIds: validWishlistProductIds,
    });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not load user state' });
  }
});

app.put('/api/user-state/:userId/cart', async (req, res) => {
  try {
    const cartItems = Array.isArray(req.body.items) ? req.body.items : [];
    const normalized = cartItems
      .filter((item) => item.productId && Number(item.quantity) > 0)
      .map((item) => ({ productId: item.productId, quantity: Number(item.quantity) }));

    const state = await UserState.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { cartItems: normalized } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(state);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not save cart' });
  }
});

app.put('/api/user-state/:userId/wishlist', async (req, res) => {
  try {
    const productIds = Array.isArray(req.body.productIds) ? Array.from(new Set(req.body.productIds.filter(Boolean))) : [];
    const state = await UserState.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { wishlistProductIds: productIds } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(state);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not save wishlist' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const userId = String(req.query.userId || '').trim();
    const query = userId ? { userId } : {};
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not load orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { userId, items, total, paymentMode, address } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User is required to place an order' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one product' });
    }
    if (!address?.name || !address?.phone || !address?.line1 || !address?.city || !address?.state || !address?.pincode) {
      return res.status(400).json({ message: 'Complete delivery address is required' });
    }

    const requestedItems = new Map();
    items
      .filter((item) => item?.product?.id && Number(item.quantity) > 0)
      .forEach((item) => {
        const productId = String(item.product.id);
        const quantity = Number(item.quantity);
        requestedItems.set(productId, (requestedItems.get(productId) || 0) + quantity);
      });

    if (!requestedItems.size) {
      return res.status(400).json({ message: 'Order must contain at least one valid product' });
    }

    const products = await Product.find({ id: { $in: Array.from(requestedItems.keys()) } });
    const productMap = new Map(products.map((product) => [product.id, product]));

    for (const [productId, quantity] of requestedItems) {
      const product = productMap.get(productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${productId} was not found` });
      }
      if (product.outOfStock || Number(product.stock || 0) < quantity) {
        return res.status(409).json({
          message: `${product.name} has only ${Math.max(0, Number(product.stock || 0))} item(s) available`,
        });
      }
    }

    const orderedItems = [];
    const decrementedItems = [];
    for (const [productId, quantity] of requestedItems) {
      const updatedProduct = await Product.findOneAndUpdate(
        { id: productId, outOfStock: { $ne: true }, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: true }
      );

      if (!updatedProduct) {
        for (const item of decrementedItems) {
          await Product.findOneAndUpdate(
            { id: item.productId },
            { $inc: { stock: item.quantity }, $set: { outOfStock: false } }
          );
        }
        return res.status(409).json({ message: 'One or more products no longer have enough stock' });
      }

      if (Number(updatedProduct.stock || 0) <= 0) {
        updatedProduct.stock = 0;
        updatedProduct.outOfStock = true;
        await updatedProduct.save();
      }

      decrementedItems.push({ productId, quantity });
      orderedItems.push({
        product: updatedProduct.toObject(),
        quantity,
      });
    }

    const user = await User.findById(userId);
    const order = await Order.create({
      id: `NV${Date.now().toString().slice(-6)}${crypto.randomInt(100, 999)}`,
      userId,
      customerName: user?.name || address.name,
      customerEmail: user?.email || '',
      date: new Date().toISOString().slice(0, 10),
      items: orderedItems,
      total: Number(total || 0),
      status: 'Placed',
      paymentMode,
      address,
    });

    await UserState.findOneAndUpdate(
      { userId },
      { $set: { cartItems: [] } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await User.findByIdAndUpdate(userId, {
      $set: {
        phone: address.phone,
        address,
      },
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not place order' });
  }
});

app.post('/api/payments/razorpay/order', async (req, res) => {
  try {
    const amount = Math.round(Number(req.body.amount || 0) * 100);
    if (!amount || amount < 100) {
      return res.status(400).json({ message: 'A valid payment amount is required' });
    }
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({
        message: 'Razorpay keys are not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env and restart the backend.',
      });
    }

    const receipt = `rcpt_${Date.now()}`;
    const order = await razorpayRequest('POST', '/v1/orders', {
      amount,
      currency: 'INR',
      receipt,
      payment_capture: 1,
      notes: {
        userId: String(req.body.userId || ''),
      },
    });

    res.status(201).json({
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not create Razorpay order' });
  }
});

app.post('/api/payments/razorpay/verify', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Payment verification data is incomplete' });
    }
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ message: 'Razorpay secret is not configured' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment signature verification failed' });
    }

    res.json({ verified: true });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not verify payment' });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const status = req.body.status;
    if (!['Placed', 'Packed', 'Shipped', 'Delivered'].includes(status)) {
      return res.status(400).json({ message: 'Invalid order status' });
    }
    const order = await Order.findOneAndUpdate({ id: req.params.id }, { $set: { status } }, { new: true });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not update order status' });
  }
});

// Upload image only and return a URL the frontend can save in MongoDB.
app.post('/api/products/upload', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(500).json({
        message: 'Image upload failed',
        error: err.message,
      });
    }

  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded' });
  }

  res.status(201).json({
    imageUrl: `${publicApiUrl}/uploads/${req.file.filename}`,
  });
  });
});

// Add or update product with image upload
app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const productData = { ...req.body };
    if (req.file) {
      productData.imageUrl = `${publicApiUrl}/uploads/${req.file.filename}`;
    }

    if (productData.imageUrl && !productData.images) {
      productData.images = [productData.imageUrl];
    }

    productData.stock = Number(productData.stock || 0);
    productData.price = Number(productData.price || 0);
    productData.mrp = Number(productData.mrp || 0);
    productData.rating = Number(productData.rating || 0);
    productData.outOfStock = productData.outOfStock === true || productData.outOfStock === 'true' || productData.stock <= 0;
    if (productData.outOfStock) {
      productData.stock = 0;
    }

    const product = await Product.findOneAndUpdate(
      { id: productData.id },
      productData,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({
      message: err.code === 11000 ? 'A product with this unique value already exists' : (err.message || 'Product could not be saved'),
      details: err,
    });
  }
});

// Get Products
app.get('/api/products', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database is not connected',
        databaseState: mongoose.connection.readyState,
      });
    }

    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({
      message: err.message || 'Could not load products',
      error: err.name,
      code: err.code,
    });
  }
});

// Delete Product
app.delete('/api/products/:id', async (req, res) => {
  try {
    await Product.deleteOne({ id: req.params.id });
    res.status(204).send();
  } catch (err) {
    res.status(400).json(err);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on ${publicApiUrl}`);
});
