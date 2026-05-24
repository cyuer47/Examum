const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { db } = require("../config/database");
const { requireAuth } = require("../middleware/auth");
const { generateCode, generateId } = require("../utils/helpers");

// Dashboard
router.get("/admin", requireAuth("admin"), (req, res) => {
  const stats = {
    examens: db.prepare("SELECT COUNT(*) as count FROM examens").get().count,
    kandidaten: db
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = ?")
      .get("kandidaat").count,
    docenten: db
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = ?")
      .get("docent").count,
    actief: db
      .prepare(
        "SELECT COUNT(*) as count FROM kandidaat_examen WHERE status = 'bezig'"
      )
      .get().count,
    afgerond: db
      .prepare(
        "SELECT COUNT(*) as count FROM kandidaat_examen WHERE status = 'beeindigd'"
      )
      .get().count,
  };

  const recenteResultaten = db
    .prepare(
      `
    SELECT r.*, u.naam as kandidaat_naam, e.titel as examen_titel
    FROM resultaten r
    JOIN kandidaat_examen ke ON r.kandidaat_examen_id = ke.id
    JOIN users u ON ke.kandidaat_id = u.id
    JOIN examens e ON ke.examen_id = e.id
    ORDER BY r.created_at DESC
    LIMIT 10
  `
    )
    .all();

  res.render("admin/dashboard", {
    user: req.session.user,
    stats,
    recenteResultaten,
    title: "Beheerdersdashboard",
  });
});

// ============================================
// KANDIDATEN BEHEER
// ============================================

router.get("/admin/kandidaten", requireAuth("admin"), (req, res) => {
  const kandidaten = db
    .prepare(
      `
    SELECT ke.*, u.naam as kandidaat_naam, e.titel as examen_titel,
           r.score_percentage, r.geslaagd, r.goed, r.totaal_vragen
    FROM kandidaat_examen ke
    JOIN users u ON ke.kandidaat_id = u.id
    JOIN examens e ON ke.examen_id = e.id
    LEFT JOIN resultaten r ON ke.id = r.kandidaat_examen_id
    ORDER BY ke.created_at DESC
  `
    )
    .all();

  const beschikbareKandidaten = db
    .prepare(
      `
    SELECT id, naam FROM users WHERE role = 'kandidaat' AND actief = 1 ORDER BY naam
  `
    )
    .all();

  const beschikbareExamens = db
    .prepare(
      `
    SELECT id, titel FROM examens WHERE actief = 1 ORDER BY titel
  `
    )
    .all();

  const alleKandidaten = db
    .prepare(
      `
    SELECT u.*,
           (SELECT COUNT(*) FROM kandidaat_examen WHERE kandidaat_id = u.id) as examens_count
    FROM users u
    WHERE u.role = 'kandidaat'
    ORDER BY u.naam
  `
    )
    .all();

  res.render("admin/kandidaten", {
    user: req.session.user,
    kandidaten,
    beschikbareKandidaten,
    beschikbareExamens,
    alleKandidaten,
    title: "Kandidaten",
  });
});

// Nieuwe kandidaat aanmaken
router.post("/admin/kandidaat/aanmaken", requireAuth("admin"), (req, res) => {
  const { naam, email, wachtwoord } = req.body;

  const trimmedNaam = (naam || "").trim();
  const trimmedPass = (wachtwoord || "").trim();

  if (!trimmedNaam || !trimmedPass) {
    return res.redirect(
      "/admin/kandidaten?error=Naam+en+wachtwoord+zijn+verplicht"
    );
  }
  if (trimmedPass.length < 6) {
    return res.redirect(
      "/admin/kandidaten?error=Wachtwoord+moet+minimaal+6+tekens+zijn"
    );
  }

  const id = generateId();
  const hash = bcrypt.hashSync(trimmedPass, 10);

  try {
    db.prepare(
      `
      INSERT INTO users (id, naam, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(id, trimmedNaam, email ? email.trim() : null, hash, "kandidaat");

    res.redirect("/admin/kandidaten?success=Kandidaat+aangemaakt");
  } catch (err) {
    res.redirect("/admin/kandidaten?error=Email+bestaat+al");
  }
});

// Kandidaat verwijderen (user)
router.post(
  "/admin/kandidaat/user-verwijder/:id",
  requireAuth("admin"),
  (req, res) => {
    db.prepare("DELETE FROM users WHERE id = ? AND role = ?").run(
      req.params.id,
      "kandidaat"
    );
    res.redirect("/admin/kandidaten?success=Kandidaat+verwijderd");
  }
);

// Kandidaat toewijzen aan examen
router.post("/admin/kandidaat/toewijzen", requireAuth("admin"), (req, res) => {
  const { kandidaat_id, examen_id, wachtwoord, tijdlimiet } = req.body;

  if (!kandidaat_id || !examen_id) {
    return res.redirect(
      "/admin/kandidaten?error=Kandidaat+en+examen+zijn+verplicht"
    );
  }

  const kandidaat = db
    .prepare("SELECT id FROM users WHERE id = ? AND role = ?")
    .get(kandidaat_id, "kandidaat");
  if (!kandidaat) {
    return res.redirect("/admin/kandidaten?error=Kandidaat+bestaat+niet");
  }

  const examen = db
    .prepare("SELECT id FROM examens WHERE id = ?")
    .get(examen_id);
  if (!examen) {
    return res.redirect("/admin/kandidaten?error=Examen+bestaat+niet");
  }

  const id = generateId();
  const inlogcode = generateCode();
  const password = (wachtwoord || "").trim() || inlogcode;
  const hash = bcrypt.hashSync(password, 10);
  const limiet = tijdlimiet ? parseInt(tijdlimiet, 10) : null;

  db.prepare(
    `
    INSERT INTO kandidaat_examen (id, kandidaat_id, examen_id, inlogcode, wachtwoord_hash, tijdlimiet)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(id, kandidaat_id, examen_id, inlogcode, hash, limiet || null);

  res.render("admin/toewijzen", {
    user: req.session.user,
    inlogcode,
    wachtwoord: password,
    title: "Kandidaat Toegewezen",
  });
});

// Reset examen
router.post("/admin/kandidaat/reset/:id", requireAuth("admin"), (req, res) => {
  const keId = req.params.id;

  // Verifieer dat het record bestaat
  const ke = db
    .prepare("SELECT id FROM kandidaat_examen WHERE id = ?")
    .get(keId);
  if (!ke) {
    return res.redirect("/admin/kandidaten?error=Niet+gevonden");
  }

  db.prepare("DELETE FROM antwoorden WHERE kandidaat_examen_id = ?").run(keId);
  db.prepare("DELETE FROM resultaten WHERE kandidaat_examen_id = ?").run(keId);
  db.prepare(
    `
    UPDATE kandidaat_examen SET status = 'niet_gestart', gestart = NULL, beeindigd = NULL, fraud_count = 0
    WHERE id = ?
  `
  ).run(keId);

  res.redirect("/admin/kandidaten?success=Examen+gereset");
});

// Verwijder kandidaat-examen toewijzing
router.post(
  "/admin/kandidaat/verwijder/:id",
  requireAuth("admin"),
  (req, res) => {
    db.prepare("DELETE FROM kandidaat_examen WHERE id = ?").run(req.params.id);
    res.redirect("/admin/kandidaten?success=Verwijderd");
  }
);

// ============================================
// DOCENTEN BEHEER
// ============================================

router.get("/admin/docenten", requireAuth("admin"), (req, res) => {
  const docenten = db
    .prepare(
      `
    SELECT u.*,
           (SELECT COUNT(*) FROM examens WHERE created_by = u.id) as examens_count
    FROM users u
    WHERE u.role = 'docent'
    ORDER BY u.naam
  `
    )
    .all();

  res.render("admin/docenten", {
    user: req.session.user,
    docenten,
    title: "Docenten",
  });
});

// Nieuwe docent aanmaken
router.post("/admin/docent/aanmaken", requireAuth("admin"), (req, res) => {
  const { naam, email, wachtwoord } = req.body;

  const trimmedNaam = (naam || "").trim();
  const trimmedPass = (wachtwoord || "").trim();

  if (!trimmedNaam || !trimmedPass) {
    return res.redirect(
      "/admin/docenten?error=Naam+en+wachtwoord+zijn+verplicht"
    );
  }
  if (trimmedPass.length < 6) {
    return res.redirect(
      "/admin/docenten?error=Wachtwoord+moet+minimaal+6+tekens+zijn"
    );
  }
  if (!email || !email.trim()) {
    return res.redirect(
      "/admin/docenten?error=E-mailadres+is+verplicht+als+inlognaam"
    );
  }

  const id = generateId();
  const hash = bcrypt.hashSync(trimmedPass, 10);
  const trimmedEmail = email.trim();

  try {
    db.prepare(
      `
      INSERT INTO users (id, naam, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(id, trimmedNaam, trimmedEmail, hash, "docent");

    res.redirect(
      "/admin/docenten?success=Docent+aangemaakt+(inloggen+met+e-mailadres)"
    );
  } catch (err) {
    res.redirect("/admin/docenten?error=Email+bestaat+al+of+ongeldige+invoer");
  }
});

// Docent verwijderen
router.post("/admin/docent/verwijder/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role = ?").run(
    req.params.id,
    "docent"
  );
  res.redirect("/admin/docenten?success=Docent+verwijderd");
});

// ============================================
// EXAMENS BEHEER
// ============================================

router.get("/admin/examens", requireAuth("admin"), (req, res) => {
  const examens = db
    .prepare(
      `
    SELECT e.*, u.naam as created_by_naam,
           (SELECT COUNT(*) FROM vragen WHERE examen_id = e.id) as aantal_vragen
    FROM examens e
    LEFT JOIN users u ON e.created_by = u.id
    ORDER BY e.created_at DESC
  `
    )
    .all();

  res.render("admin/examens", {
    user: req.session.user,
    examens,
    title: "Examens",
  });
});

router.post("/admin/examen/aanmaken", requireAuth("admin"), (req, res) => {
  const { titel, beschrijving, tijdlimiet, min_score } = req.body;

  if (!titel || !titel.trim()) {
    return res.redirect("/admin/examens?error=Titel+is+verplicht");
  }

  const limiet = parseInt(tijdlimiet, 10) || 45;
  const minScore = parseFloat(min_score) || 70;

  if (limiet < 1 || limiet > 480) {
    return res.redirect(
      "/admin/examens?error=Tijdlimiet+moet+tussen+1+en+480+minuten+liggen"
    );
  }

  const id = generateId();
  db.prepare(
    `
    INSERT INTO examens (id, titel, beschrijving, tijdlimiet, min_score, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    titel.trim(),
    beschrijving ? beschrijving.trim() : null,
    limiet,
    minScore,
    req.session.user.id
  );

  res.redirect("/admin/examens?success=Examen+aangemaakt");
});

router.post("/admin/examen/bewerk/:id", requireAuth("admin"), (req, res) => {
  const { titel, beschrijving, tijdlimiet, min_score, actief } = req.body;

  if (!titel || !titel.trim()) {
    return res.redirect("/admin/examens?error=Titel+is+verplicht");
  }

  // Verifieer dat examen bestaat
  const examen = db
    .prepare("SELECT id FROM examens WHERE id = ?")
    .get(req.params.id);
  if (!examen) {
    return res.redirect("/admin/examens?error=Examen+niet+gevonden");
  }

  db.prepare(
    `
    UPDATE examens SET titel = ?, beschrijving = ?, tijdlimiet = ?, min_score = ?, actief = ?
    WHERE id = ?
  `
  ).run(
    titel.trim(),
    beschrijving ? beschrijving.trim() : null,
    parseInt(tijdlimiet, 10) || 45,
    parseFloat(min_score) || 70,
    actief ? 1 : 0,
    req.params.id
  );

  res.redirect("/admin/examens?success=Examen+bijgewerkt");
});

// ============================================
// VRAGEN BEHEER
// ============================================

router.get("/admin/vragen/:examen_id", requireAuth("admin"), (req, res) => {
  const examen = db
    .prepare("SELECT * FROM examens WHERE id = ?")
    .get(req.params.examen_id);
  if (!examen) {
    return res.redirect("/admin/examens?error=Examen+niet+gevonden");
  }

  const vragen = db
    .prepare(
      `
    SELECT v.*,
           (SELECT COUNT(*) FROM antwoord_opties WHERE vraag_id = v.id) as aantal_opties
    FROM vragen v
    WHERE v.examen_id = ?
    ORDER BY v.volgorde, v.created_at
  `
    )
    .all(req.params.examen_id);

  res.render("admin/vragen", {
    user: req.session.user,
    examen,
    vragen,
    title: "Vragen beheren",
  });
});

// Vraag toevoegen
router.post("/admin/vraag/toevoegen", requireAuth("admin"), (req, res) => {
  const { examen_id, vraag_tekst, vraag_type, volgorde, afbeelding_url } =
    req.body;

  if (!examen_id || !vraag_tekst || !vraag_tekst.trim()) {
    return res.redirect("back");
  }

  // Verifieer examen bestaat
  const examen = db
    .prepare("SELECT id FROM examens WHERE id = ?")
    .get(examen_id);
  if (!examen) {
    return res.redirect("/admin/examens?error=Examen+niet+gevonden");
  }

  const id = generateId();
  const isInfo = vraag_type === "info" ? 1 : 0;
  const volgordeVal = parseInt(volgorde, 10) || 0;

  db.prepare(
    `
    INSERT INTO vragen (id, examen_id, vraag_tekst, is_info, volgorde, afbeelding_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    examen_id,
    vraag_tekst.trim(),
    isInfo,
    volgordeVal,
    afbeelding_url ? afbeelding_url.trim() : null
  );

  if (vraag_type === "multiple_choice") {
    return res.redirect(
      "/admin/vraag/opties/" + id + "?examen_id=" + examen_id
    );
  }

  res.redirect("/admin/vragen/" + examen_id + "?success=Vraag+toegevoegd");
});

// Opties pagina voor Meerkeuzevragen
router.get(
  "/admin/vraag/opties/:vraag_id",
  requireAuth("admin"),
  (req, res) => {
    const vraag = db
      .prepare("SELECT * FROM vragen WHERE id = ?")
      .get(req.params.vraag_id);
    if (!vraag) {
      return res.redirect("/admin/examens?error=Vraag+niet+gevonden");
    }

    const examen = db
      .prepare("SELECT * FROM examens WHERE id = ?")
      .get(req.query.examen_id || vraag.examen_id);
    const opties = db
      .prepare(
        `
    SELECT * FROM antwoord_opties WHERE vraag_id = ? ORDER BY label
  `
      )
      .all(req.params.vraag_id);

    res.render("admin/opties", {
      user: req.session.user,
      vraag,
      examen,
      opties,
      title: "Antwoordopties",
    });
  }
);

// Opties toevoegen
router.post("/admin/opties/toevoegen", requireAuth("admin"), (req, res) => {
  const { vraag_id, examen_id, labels, teksten, correct } = req.body;

  if (!vraag_id || !examen_id) {
    return res.redirect("/admin/examens?error=Ongeldige+aanvraag");
  }

  // Verifieer dat vraag bestaat en bij het opgegeven examen hoort
  const vraag = db
    .prepare("SELECT id FROM vragen WHERE id = ? AND examen_id = ?")
    .get(vraag_id, examen_id);
  if (!vraag) {
    return res.redirect("/admin/examens?error=Vraag+niet+gevonden");
  }

  const labelArr = Array.isArray(labels) ? labels : [labels].filter(Boolean);
  const tekstArr = Array.isArray(teksten) ? teksten : [teksten].filter(Boolean);
  const correctArr = Array.isArray(correct)
    ? correct
    : correct
      ? [correct]
      : [];

  const insert = db.prepare(`
    INSERT INTO antwoord_opties (id, vraag_id, label, tekst, is_correct)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < labelArr.length; i++) {
    if (labelArr[i] && tekstArr[i]) {
      const isCorrect =
        correctArr.includes(String(i)) || correctArr.includes(labelArr[i])
          ? 1
          : 0;
      insert.run(
        generateId(),
        vraag_id,
        labelArr[i].trim(),
        tekstArr[i].trim(),
        isCorrect
      );
    }
  }

  res.redirect("/admin/vragen/" + examen_id + "?success=Opties+toegevoegd");
});

// Vraag verwijderen
router.post("/admin/vraag/verwijder/:id", requireAuth("admin"), (req, res) => {
  const vraag = db
    .prepare("SELECT examen_id FROM vragen WHERE id = ?")
    .get(req.params.id);
  if (!vraag) {
    return res.redirect("/admin/examens?error=Vraag+niet+gevonden");
  }
  db.prepare("DELETE FROM vragen WHERE id = ?").run(req.params.id);
  res.redirect(
    "/admin/vragen/" + vraag.examen_id + "?success=Vraag+verwijderd"
  );
});

module.exports = router;
