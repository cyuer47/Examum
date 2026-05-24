require("dotenv").config();
const express = require("express");
const session = require("express-session");
const expressLayouts = require("express-ejs-layouts");
const helmet = require("helmet");
const path = require("path");

const { db } = require("./config/database");
const { helmetConfig } = require("./middleware/security");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet(helmetConfig));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, "..", "public")));

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 uur
    },
    name: "examen.sid",
  })
);

// EJS setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

// Routes
app.use("/", require("./routes/index"));
app.use("/", require("./routes/admin"));
app.use("/", require("./routes/docent"));
app.use("/", require("./routes/kandidaat"));
app.use("/api", require("./routes/api"));

// Error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).render("error", {
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Er is iets misgegaan",
    title: "Fout",
  });
});

app.listen(PORT, () => {
  console.log(`Examum draait op http://localhost:${PORT}`);
  console.log(`Admin login: http://localhost:${PORT}/login`);
  console.log(`Kandidaat login: http://localhost:${PORT}/kandidaat-login`);
});
