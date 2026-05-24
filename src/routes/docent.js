const express = require("express");
const router = express.Router();
const { db } = require("../config/database");
const { requireAuth } = require("../middleware/auth");
const { generateId } = require("../utils/helpers");

// Dashboard – docent ziet alleen eigen examens; admin ziet alle
router.get("/docent", requireAuth("docent"), (req, res) => {
  // FIX: vroeger was "? = 1" vergelijking broken; nu expliciete branch
  const examens =
    req.session.user.role === "admin"
      ? db
          .prepare(
            `
        SELECT e.*,
               (SELECT COUNT(*) FROM vragen WHERE examen_id = e.id) as aantal_vragen,
               (SELECT COUNT(*) FROM kandidaat_examen WHERE examen_id = e.id) as aantal_kandidaten
        FROM examens e
        ORDER BY e.created_at DESC
      `
          )
          .all()
      : db
          .prepare(
            `
        SELECT e.*,
               (SELECT COUNT(*) FROM vragen WHERE examen_id = e.id) as aantal_vragen,
               (SELECT COUNT(*) FROM kandidaat_examen WHERE examen_id = e.id) as aantal_kandidaten
        FROM examens e
        WHERE e.created_by = ?
        ORDER BY e.created_at DESC
      `
          )
          .all(req.session.user.id);

  res.render("docent/dashboard", {
    user: req.session.user,
    examens,
    title: "Docentendashboard",
  });
});

// Resultaten per examen – controleer eigenaarschap
router.get(
  "/docent/resultaten/:examen_id",
  requireAuth("docent"),
  (req, res) => {
    const examen =
      req.session.user.role === "admin"
        ? db
            .prepare("SELECT * FROM examens WHERE id = ?")
            .get(req.params.examen_id)
        : db
            .prepare("SELECT * FROM examens WHERE id = ? AND created_by = ?")
            .get(req.params.examen_id, req.session.user.id);

    if (!examen) {
      return res.status(403).render("error", {
        message: "Geen toegang tot dit examen",
        title: "Verboden",
      });
    }

    const resultaten = db
      .prepare(
        `
    SELECT r.*, u.naam as kandidaat_naam, ke.gestart, ke.beeindigd, ke.fraud_count
    FROM resultaten r
    JOIN kandidaat_examen ke ON r.kandidaat_examen_id = ke.id
    JOIN users u ON ke.kandidaat_id = u.id
    WHERE ke.examen_id = ?
    ORDER BY r.score_percentage DESC
  `
      )
      .all(req.params.examen_id);

    res.render("docent/resultaten", {
      user: req.session.user,
      examen,
      resultaten,
      title: "Resultaten",
    });
  }
);

// Open vragen overzicht – FIX: N+1 opgelost met één query via LEFT JOIN
router.get(
  "/docent/open-vragen/:examen_id",
  requireAuth("docent"),
  (req, res) => {
    const examen =
      req.session.user.role === "admin"
        ? db
            .prepare("SELECT * FROM examens WHERE id = ?")
            .get(req.params.examen_id)
        : db
            .prepare("SELECT * FROM examens WHERE id = ? AND created_by = ?")
            .get(req.params.examen_id, req.session.user.id);

    if (!examen) {
      return res.status(403).render("error", {
        message: "Geen toegang tot dit examen",
        title: "Verboden",
      });
    }

    // Alle open vragen met antwoorden en beoordelingen in één query
    const openVragen = db
      .prepare(
        `
    SELECT v.id as vraag_id, v.vraag_tekst, v.volgorde,
           a.id as antwoord_id, a.gegeven_antwoord, a.is_correct,
           u.naam as kandidaat_naam, ke.id as ke_id,
           db.id as beoordeling_id, db.score as beoordeling_score,
           db.feedback as beoordeling_feedback
    FROM vragen v
    JOIN antwoorden a ON v.id = a.vraag_id
    JOIN kandidaat_examen ke ON a.kandidaat_examen_id = ke.id
    JOIN users u ON ke.kandidaat_id = u.id
    LEFT JOIN docent_beoordelingen db ON db.antwoord_id = a.id
    WHERE v.examen_id = ? AND v.is_info = 0
    AND v.id NOT IN (SELECT vraag_id FROM antwoord_opties GROUP BY vraag_id)
    ORDER BY v.volgorde, u.naam
  `
      )
      .all(req.params.examen_id);

    // Zet beoordeling om naar genest object (voor compatibiliteit met view)
    const openVragenMapped = openVragen.map((v) => ({
      ...v,
      beoordeling: v.beoordeling_id
        ? {
            id: v.beoordeling_id,
            score: v.beoordeling_score,
            feedback: v.beoordeling_feedback,
          }
        : null,
    }));

    res.render("docent/open-vragen", {
      user: req.session.user,
      examen,
      openVragen: openVragenMapped,
      title: "Open Vragen Nakijken",
    });
  }
);

// Open vraag beoordelen – controleer eigenaarschap examen
router.post("/docent/beoordeel", requireAuth("docent"), (req, res) => {
  const { antwoord_id, score, feedback, examen_id } = req.body;

  if (!antwoord_id || score === undefined || score === "") {
    return res.redirect(
      "/docent/open-vragen/" + examen_id + "?error=Ongeldige+invoer"
    );
  }

  // Verifieer dat het antwoord bij een examen van deze docent hoort
  const check =
    req.session.user.role === "admin"
      ? db
          .prepare(
            `
        SELECT a.id FROM antwoorden a
        JOIN kandidaat_examen ke ON a.kandidaat_examen_id = ke.id
        JOIN examens e ON ke.examen_id = e.id
        WHERE a.id = ? AND e.id = ?
      `
          )
          .get(antwoord_id, examen_id)
      : db
          .prepare(
            `
        SELECT a.id FROM antwoorden a
        JOIN kandidaat_examen ke ON a.kandidaat_examen_id = ke.id
        JOIN examens e ON ke.examen_id = e.id
        WHERE a.id = ? AND e.id = ? AND e.created_by = ?
      `
          )
          .get(antwoord_id, examen_id, req.session.user.id);

  if (!check) {
    return res
      .status(403)
      .render("error", { message: "Geen toegang", title: "Verboden" });
  }

  const scoreVal = parseFloat(score);

  // Verwijder oude beoordeling
  db.prepare("DELETE FROM docent_beoordelingen WHERE antwoord_id = ?").run(
    antwoord_id
  );

  db.prepare(
    `
    INSERT INTO docent_beoordelingen (id, antwoord_id, docent_id, score, feedback)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(
    generateId(),
    antwoord_id,
    req.session.user.id,
    scoreVal,
    feedback ? feedback.trim() : null
  );

  const isCorrect = scoreVal > 0 ? 1 : 0;
  db.prepare("UPDATE antwoorden SET is_correct = ? WHERE id = ?").run(
    isCorrect,
    antwoord_id
  );

  const antwoord = db
    .prepare("SELECT kandidaat_examen_id FROM antwoorden WHERE id = ?")
    .get(antwoord_id);
  if (antwoord) {
    recalculateResult(antwoord.kandidaat_examen_id);
  }

  res.redirect("/docent/open-vragen/" + examen_id + "?success=Beoordeeld");
});

function recalculateResult(keId) {
  const ke = db
    .prepare("SELECT examen_id FROM kandidaat_examen WHERE id = ?")
    .get(keId);
  if (!ke) return;

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
    UPDATE resultaten SET goed = ?, score_percentage = ?, geslaagd = ? WHERE kandidaat_examen_id = ?
  `
  ).run(goed, percentage.toFixed(2), geslaagd, keId);
}

module.exports = router;
