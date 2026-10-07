import 'dotenv/config';
import crypto from 'node:crypto';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import { engine } from 'express-handlebars';
import { connectDb } from './db.js';
import { AtlasSessionStore } from './atlas-session-store.js';
import { createRules } from './personalization.js';

for (const key of [
  'MONGO_URI_READ',
  'MONGO_URI_WRITE',
  'SESSION_SECRET',
  'ADMIN_PASSWORD',
  'STUDENT_ID',
  'STUDENT_NAME'
]) {
  if (!process.env[key]) {
    throw new Error(`Thiếu biến môi trường: ${key}`);
  }
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET phải có ít nhất 32 ký tự');
}

const studentId = process.env.STUDENT_ID;
const rules = createRules(studentId);

// DNS local đang trả 127.0.0.1 và từ chối truy vấn SRV của Atlas.
const usesSrv = [process.env.MONGO_URI_READ, process.env.MONGO_URI_WRITE]
  .some((uri) => uri.startsWith('mongodb+srv://'));

if (
  process.env.NODE_ENV !== 'production' &&
  usesSrv &&
  dns.getServers().includes('127.0.0.1')
) {
  dns.setServers(['1.1.1.3']);
}

const db = await connectDb();
const app = express();

app.set('trust proxy', 1);
app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.locals.studentName = process.env.STUDENT_NAME;
app.locals.studentId = studentId;
app.locals.vatRate = rules.vatRate;

app.get('/health', (_req, res) => res.send('OK'));

app.use(session({
  name: 'book.sid',
  secret: process.env.SESSION_SECRET,
  store: new AtlasSessionStore(db.readSessions, db.writeSessions),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.get('/session-test', (req, res, next) => {
  req.session.visitCount = (req.session.visitCount ?? 0) + 1;
  req.session.save((error) => {
    if (error) return next(error);
    res.json({ visitCount: req.session.visitCount });
  });
});

function samePassword(input, expected) {
  const left = crypto.createHash('sha256').update(input).digest();
  const right = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

app.post('/login', (req, res, next) => {
  const password = req.body.password;
  if (
    typeof password !== 'string' ||
    !samePassword(password, process.env.ADMIN_PASSWORD)
  ) {
    return res.status(401).send('Sai mật khẩu quản trị.');
  }

  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.isAdmin = true;
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.redirect(303, '/');
    });
  });
});

app.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('book.sid');
    res.redirect(303, '/');
  });
});

app.get('/', async (req, res, next) => {
  try {
    const documents = await db.readBooks
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const books = documents.map((book) => ({
      code: book.code,
      title: book.title,
      basePrice: book.basePrice,
      vatRate: book.vatRate,
      totalPrice: book.totalPrice
    }));

    res.render('home', {
      books,
      prefix: rules.prefix,
      isAdmin: Boolean(req.session.isAdmin)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/books', async (req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(403).send('Cần đăng nhập quản trị.');
  }

  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const priceText = typeof req.body.price === 'string' ? req.body.price.trim() : '';

  if (!rules.isValidCode(code)) {
    return res.status(400).send(`Mã sách phải bắt đầu bằng ${rules.prefix}.`);
  }
  if (title.length < 1 || title.length > 120) {
    return res.status(400).send('Tên sách không hợp lệ.');
  }
  if (!/^\d+$/.test(priceText)) {
    return res.status(400).send('Giá phải là số nguyên không âm.');
  }

  const basePrice = Number(priceText);
  let totalPrice;
  try {
    totalPrice = rules.priceAfterVat(basePrice);
  } catch (error) {
    return res.status(400).send(error.message);
  }

  try {
    await db.writeBooks.insertOne({
      code,
      title,
      basePrice,
      vatRate: rules.vatRate,
      totalPrice,
      createdAt: new Date()
    });
    res.redirect(303, '/');
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send('Mã sách đã tồn tại.');
    }
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send('Lỗi máy chủ.');
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Đang chạy tại http://localhost:${port} — VAT ${rules.vatRate}%`);
});
