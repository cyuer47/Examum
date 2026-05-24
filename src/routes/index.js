const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { db } = require("../config/database");
const { loginLimiter } = require("../middleware/security");

// Home
router.get("/", (req, res) => {
  res.redirect("/login");
});

// Admin/Docent Login pagina
router.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect(
      req.session.user.role === "admin" ? "/admin" : "/docent"
    );
  }
  res.render("login", { title: "Inloggen", layout: false });
});

// Admin/Docent Login POST – met session regeneration (voorkomt session fixation)
router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", {
      title: "Inloggen",
      layout: false,
      error: "Vul alle velden in",
    });
  }

  // Zoek op username OF email (voor docenten die geen username hebben)
  const user = db
    .prepare(
      "SELECT * FROM users WHERE (username = ? OR email = ?) AND actief = 1"
    )
    .get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render("login", {
      title: "Inloggen",
      layout: false,
      error: "Ongeldige gebruikersnaam of wachtwoord",
    });
  }

  const userData = {
    id: user.id,
    naam: user.naam,
    username: user.username,
    role: user.role,
  };

  // Regenereer sessie om session fixation te voorkomen
  req.session.regenerate((err) => {
    if (err)
      return res
        .status(500)
        .render("error", { message: "Sessie fout", title: "Fout" });
    req.session.user = userData;
    res.redirect(user.role === "admin" ? "/admin" : "/docent");
  });
});

// Kandidaat login pagina
router.get("/kandidaat-login", (req, res) => {
  if (req.session.kandidaatExamen) {
    return res.redirect("/examen");
  }
  res.render("student/login", {
    title: "Inloggen voor leerlingen",
    layout: false,
  });
});

// Kandidaat login POST – met session regeneration
router.post("/kandidaat-login", loginLimiter, (req, res) => {
  const { inlogcode, wachtwoord } = req.body;

  if (!inlogcode || !wachtwoord) {
    return res.render("student/login", {
      title: "Inloggen voor leerlingen",
      layout: false,
      error: "Vul alle velden in",
    });
  }

  const cleanCode = inlogcode.replace(/\s/g, "").toUpperCase();

  const ke = db
    .prepare(
      `
    SELECT ke.*, u.naam as kandidaat_naam, e.titel as examen_titel,
           e.tijdlimiet as examen_tijdlimiet
    FROM kandidaat_examen ke
    JOIN users u ON ke.kandidaat_id = u.id
    JOIN examens e ON ke.examen_id = e.id
    WHERE ke.inlogcode = ? AND ke.status != 'beeindigd'
  `
    )
    .get(cleanCode);

  if (!ke || !bcrypt.compareSync(wachtwoord, ke.wachtwoord_hash)) {
    return res.render("student/login", {
      title: "Inloggen voor leerlingen",
      layout: false,
      error: "Ongeldige inlogcode of wachtwoord",
    });
  }

  const keData = { ...ke };

  req.session.regenerate((err) => {
    if (err)
      return res
        .status(500)
        .render("error", { message: "Sessie fout", title: "Fout" });
    req.session.kandidaatExamen = keData;
    res.redirect("/examen");
  });
});

// Logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

module.exports = router;
