const express = require("express");
const router = express.Router();
const { db } = require("../config/database");
const { requireKandidaat, requireActiveExamen } = require("../middleware/auth");
const { generateId } = require("../utils/helpers");

// Examen start pagina
router.get("/examen", requireKandidaat, (req, res) => {
  const assignment = req.session.kandidaatExamen;

  const ke = db
    .prepare(
      `
    SELECT ke.*, u.naam as kandidaat_naam, e.titel as examen_titel,
           e.tijdlimiet as examen_tijdlimiet, e.beschrijving, e.min_score
    FROM kandidaat_examen ke
    JOIN users u ON ke.kandidaat_id = u.id
    JOIN examens e ON ke.examen_id = e.id
    WHERE ke.id = ?
  `
    )
    .get(assignment.id);

  if (!ke) {
    req.session.destroy(() => res.redirect("/kandidaat-login"));
    return;
  }

  req.session.kandidaatExamen = ke;

  if (ke.status === "beeindigd") {
    return res.redirect("/examen/resultaat");
  }

  const examen = db
    .prepare("SELECT * FROM examens WHERE id = ?")
    .get(ke.examen_id);
  const aantalVragen = db
    .prepare(
      "SELECT COUNT(*) as count FROM vragen WHERE examen_id = ? AND is_info = 0"
    )
    .get(ke.examen_id).count;
  const aantalInfo = db
    .prepare(
      "SELECT COUNT(*) as count FROM vragen WHERE examen_id = ? AND is_info = 1"
    )
    .get(ke.examen_id).count;
  const aantalOpen = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM vragen v
    WHERE v.examen_id = ? AND v.is_info = 0
    AND v.id NOT IN (SELECT vraag_id FROM antwoord_opties GROUP BY vraag_id)
  `
    )
    .get(ke.examen_id).count;

  res.render("student/start", {
    examen,
    assignment: ke,
    aantalVragen,
    aantalInfo,
    aantalOpen,
    user: { naam: ke.kandidaat_naam },
    title: "Examen Starten",
  });
});

// Start examen
router.post("/examen/start", requireKandidaat, (req, res) => {
  const assignment = req.session.kandidaatExamen;

  const current = db
    .prepare("SELECT status FROM kandidaat_examen WHERE id = ?")
    .get(assignment.id);
  if (!current) {
    return req.session.destroy(() => res.redirect("/kandidaat-login"));
  }

  if (current.status === "beeindigd") {
    return res.redirect("/examen/resultaat");
  }

  if (current.status === "niet_gestart") {
    const clientIP = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      ""
    )
      .split(",")[0]
      .trim();

    db.prepare(
      `
      UPDATE kandidaat_examen
      SET status = 'bezig', gestart = datetime('now'), ip_address = ?
      WHERE id = ?
    `
    ).run(clientIP, assignment.id);

    db.prepare(
      `
      INSERT INTO fraud_logs (id, kandidaat_examen_id, event_type, event_data)
      VALUES (?, ?, ?, ?)
    `
    ).run(
      generateId(),
      assignment.id,
      "exam_start",
      JSON.stringify({ ip: clientIP })
    );
  }

  res.redirect("/examen/vraag/1");
});

// Vraag pagina
router.get("/examen/vraag/:nr", requireKandidaat, (req, res) => {
  const assignment = req.session.kandidaatExamen;
  const vraagNr = parseInt(req.params.nr, 10);

  if (isNaN(vraagNr) || vraagNr < 1) {
    return res.redirect("/examen/vraag/1");
  }

  const ke = db
    .prepare(
      `
    SELECT ke.*, u.naam as kandidaat_naam, e.titel as examen_titel,
           e.tijdlimiet as examen_tijdlimiet
    FROM kandidaat_examen ke
    JOIN users u ON ke.kandidaat_id = u.id
    JOIN examens e ON ke.examen_id = e.id
    WHERE ke.id = ?
  `
    )
    .get(assignment.id);

  if (!ke) {
    return res.redirect("/kandidaat-login");
  }

  req.session.kandidaatExamen = ke;

  if (ke.status === "beeindigd") return res.redirect("/examen/resultaat");
  if (ke.status === "niet_gestart") return res.redirect("/examen");

  const examen = db
    .prepare("SELECT * FROM examens WHERE id = ?")
    .get(ke.examen_id);

  const vragen = db
    .prepare(
      `
    SELECT * FROM vragen WHERE examen_id = ? ORDER BY volgorde, created_at
  `
    )
    .all(ke.examen_id);

  if (vragen.length === 0) {
    return res.send("Geen vragen gevonden voor dit examen.");
  }

  if (vraagNr > vragen.length) {
    return res.redirect("/examen/vraag/" + vragen.length);
  }

  const huidigeVraag = vragen[vraagNr - 1];

  const opties = db
    .prepare(
      `
    SELECT * FROM antwoord_opties WHERE vraag_id = ? ORDER BY label
  `
    )
    .all(huidigeVraag.id);

  const isMultipleChoice = opties.length > 0;
  const isOpen = !huidigeVraag.is_info && opties.length === 0;

  const gegeven = db
    .prepare(
      `
    SELECT gegeven_antwoord FROM antwoorden
    WHERE kandidaat_examen_id = ? AND vraag_id = ?
  `
    )
    .get(ke.id, huidigeVraag.id);

  const beantwoorde = db
    .prepare(
      "SELECT vraag_id, gegeven_antwoord FROM antwoorden WHERE kandidaat_examen_id = ?"
    )
    .all(ke.id);

  const beantwoordMap = {};
  beantwoorde.forEach((a) => {
    beantwoordMap[a.vraag_id] = a.gegeven_antwoord;
  });

  // TIMER – gebruik UTC-bewuste conversie van SQLite datetime
  let overSec = 0;

  if (ke.gestart) {
    const gestartDate = new Date(ke.gestart.replace(" ", "T") + "Z");
    const tijdlimietMin = ke.tijdlimiet || ke.examen_tijdlimiet || 45;
    const tijdlimietSec = tijdlimietMin * 60;
    const verstrekenSec = Math.floor(
      (Date.now() - gestartDate.getTime()) / 1000
    );
    overSec = Math.max(0, tijdlimietSec - verstrekenSec);
  }

  if (overSec <= 0 && ke.status === "bezig") {
    finishExamen(ke.id);
    return res.redirect("/examen/resultaat");
  }

  res.render("student/vraag", {
    user: { naam: ke.kandidaat_naam },
    assignment: ke,
    examen,
    vraag: huidigeVraag,
    opties,
    isMultipleChoice,
    isOpen,
    vraagNr,
    totaalVragen: vragen.length,
    gegevenAntwoord: gegeven ? gegeven.gegeven_antwoord : null,
    beantwoordMap,
    vragen,
    overSec,
    title: "Vraag " + vraagNr,
  });
});

// Antwoord opslaan – FIX: verifieer dat vraag_id bij het examen van de kandidaat hoort
router.post("/examen/antwoord", requireKandidaat, (req, res) => {
  const { vraag_id, antwoord } = req.body;
  const assignment = req.session.kandidaatExamen;

  if (!vraag_id) {
    return res.status(400).json({ error: "Vraag ID ontbreekt" });
  }

  // Check of examen nog bezig is
  const current = db
    .prepare("SELECT status, examen_id FROM kandidaat_examen WHERE id = ?")
    .get(assignment.id);
  if (!current || current.status !== "bezig") {
    return res.status(403).json({ error: "Examen is niet actief" });
  }

  // SECURITY FIX: Verifieer dat vraag_id bij dit examen hoort
  const vraag = db
    .prepare("SELECT id FROM vragen WHERE id = ? AND examen_id = ?")
    .get(vraag_id, current.examen_id);

  if (!vraag) {
    return res.status(403).json({ error: "Vraag hoort niet bij dit examen" });
  }

  const opties = db
    .prepare("SELECT label, is_correct FROM antwoord_opties WHERE vraag_id = ?")
    .all(vraag_id);

  let isCorrect = 0;
  if (opties.length > 0) {
    const correct = opties.find((o) => o.is_correct === 1);
    isCorrect = correct && correct.label === antwoord ? 1 : 0;
  }

  const existing = db
    .prepare(
      "SELECT id FROM antwoorden WHERE kandidaat_examen_id = ? AND vraag_id = ?"
    )
    .get(assignment.id, vraag_id);

  if (existing) {
    db.prepare(
      `
      UPDATE antwoorden SET gegeven_antwoord = ?, is_correct = ?, tijdstip = datetime('now') WHERE id = ?
    `
    ).run(antwoord || null, isCorrect, existing.id);
  } else {
    db.prepare(
      `
      INSERT INTO antwoorden (id, kandidaat_examen_id, vraag_id, gegeven_antwoord, is_correct)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(generateId(), assignment.id, vraag_id, antwoord || null, isCorrect);
  }

  res.json({ success: true, isCorrect, isOpen: opties.length === 0 });
});

// Inleveren – POST
router.post("/examen/inleveren", requireKandidaat, (req, res) => {
  const assignment = req.session.kandidaatExamen;

  const current = db
    .prepare("SELECT status FROM kandidaat_examen WHERE id = ?")
    .get(assignment.id);
  if (current && current.status === "bezig") {
    finishExamen(assignment.id);
  }

  res.json({ success: true });
});

// Inleveren – GET (voor timer timeout redirect)
router.get("/examen/inleveren", requireKandidaat, (req, res) => {
  const assignment = req.session.kandidaatExamen;

  const current = db
    .prepare("SELECT status FROM kandidaat_examen WHERE id = ?")
    .get(assignment.id);
  if (current && current.status === "bezig") {
    finishExamen(assignment.id);
  }

  res.redirect("/examen/resultaat");
});

function finishExamen(keId) {
  const ke = db
    .prepare("SELECT * FROM kandidaat_examen WHERE id = ?")
    .get(keId);
  if (!ke || ke.status === "beeindigd") return;

  const totaalRow = db
    .prepare(
      "SELECT COUNT(*) as count FROM vragen WHERE examen_id = ? AND is_info = 0"
    )
    .get(ke.examen_id);

  const antwoorden = db
    .prepare("SELECT is_correct FROM antwoorden WHERE kandidaat_examen_id = ?")
    .all(keId);

  const goed = antwoorden.filter((a) => a.is_correct === 1).length;
  const totaal = totaalRow.count;
  const percentage = totaal > 0 ? (goed / totaal) * 100 : 0;

  const examen = db
    .prepare("SELECT min_score FROM examens WHERE id = ?")
    .get(ke.examen_id);
  const geslaagd = percentage >= (examen.min_score || 70) ? 1 : 0;

  db.prepare(
    `
    UPDATE kandidaat_examen SET status = 'beeindigd', beeindigd = datetime('now') WHERE id = ?
  `
  ).run(keId);

  db.prepare(
    `
    INSERT OR REPLACE INTO resultaten (id, kandidaat_examen_id, totaal_vragen, goed, score_percentage, geslaagd)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(generateId(), keId, totaal, goed, percentage.toFixed(2), geslaagd);
}

// Resultaat pagina
router.get("/examen/resultaat", requireKandidaat, (req, res) => {
  const assignment = req.session.kandidaatExamen;

  const ke = db
    .prepare(
      `
    SELECT ke.*, u.naam as kandidaat_naam
    FROM kandidaat_examen ke
    JOIN users u ON ke.kandidaat_id = u.id
    WHERE ke.id = ?
  `
    )
    .get(assignment.id);

  if (!ke || ke.status !== "beeindigd") {
    return res.redirect("/examen");
  }

  req.session.kandidaatExamen = ke;

  const resultaat = db
    .prepare("SELECT * FROM resultaten WHERE kandidaat_examen_id = ?")
    .get(ke.id);

  const examen = db
    .prepare("SELECT * FROM examens WHERE id = ?")
    .get(ke.examen_id);

  const openVragen = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM vragen v
    LEFT JOIN antwoord_opties ao ON v.id = ao.vraag_id
    WHERE v.examen_id = ? AND v.is_info = 0 AND ao.id IS NULL
  `
    )
    .get(ke.examen_id).count;

  res.render("student/resultaat", {
    user: { naam: ke.kandidaat_naam },
    resultaat,
    examen,
    assignment: ke,
    openVragen,
    title: "Examenresultaat",
  });
});

// Inzien pagina
router.get("/examen/inzien", requireKandidaat, (req, res) => {
  const assignment = req.session.kandidaatExamen;

  const ke = db
    .prepare(
      `
    SELECT ke.*, u.naam as kandidaat_naam
    FROM kandidaat_examen ke
    JOIN users u ON ke.kandidaat_id = u.id
    WHERE ke.id = ?
  `
    )
    .get(assignment.id);

  if (!ke || ke.status !== "beeindigd") {
    return res.redirect("/examen");
  }

  req.session.kandidaatExamen = ke;

  const examen = db
    .prepare("SELECT * FROM examens WHERE id = ?")
    .get(ke.examen_id);

  const vragen = db
    .prepare(
      `
    SELECT v.*, a.gegeven_antwoord, a.is_correct,
           (SELECT label FROM antwoord_opties WHERE vraag_id = v.id AND is_correct = 1) as correct_label
    FROM vragen v
    LEFT JOIN antwoorden a ON v.id = a.vraag_id AND a.kandidaat_examen_id = ?
    WHERE v.examen_id = ?
    ORDER BY v.volgorde, v.created_at
  `
    )
    .all(ke.id, ke.examen_id);

  vragen.forEach((vraag) => {
    vraag.opties = db
      .prepare(
        "SELECT * FROM antwoord_opties WHERE vraag_id = ? ORDER BY label"
      )
      .all(vraag.id);
    vraag.isOpen = vraag.opties.length === 0 && !vraag.is_info;
  });

  const resultaat = db
    .prepare("SELECT * FROM resultaten WHERE kandidaat_examen_id = ?")
    .get(ke.id);

  res.render("student/inzien", {
    user: { naam: ke.kandidaat_naam },
    examen,
    vragen,
    resultaat,
    assignment: ke,
    title: "Examen inzien",
  });
});

module.exports = router;
