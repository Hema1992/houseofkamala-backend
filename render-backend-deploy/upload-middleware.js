const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, 'uploads');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const upload = multer({ storage });

module.exports = upload;
