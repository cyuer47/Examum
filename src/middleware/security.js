const rateLimit = require("express-rate-limit");

// Rate limiting voor login pogingen
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuten
  max: 10,
  message: "Te veel login pogingen, probeer later opnieuw.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting voor API
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: "Te veel requests",
});

// Security headers via Helmet
// Geen 'unsafe-inline' in scriptSrc: alle JS staat in /public/js/main.js
// Geen inline event handlers (onclick/onchange) in templates
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:", "*"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
};

module.exports = { loginLimiter, apiLimiter, helmetConfig };
