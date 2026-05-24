const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_DIR = path.join(__dirname, "..", "db");
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, "examen.db");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Performance & veiligheid settings
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -64000");
db.pragma("temp_store = MEMORY");

// Schema initialisatie
function initSchema() {
  db.exec(`
    -- Gebruikers (admin, docent, kandidaat)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      naam TEXT NOT NULL,
      username TEXT UNIQUE,
      email TEXT,
      password_hash TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin', 'docent', 'kandidaat')),
      actief INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Examens
    CREATE TABLE IF NOT EXISTS examens (
      id TEXT PRIMARY KEY,
      titel TEXT NOT NULL,
      beschrijving TEXT,
      tijdlimiet INTEGER DEFAULT 45,
      min_score REAL DEFAULT 70.0,
      actief INTEGER DEFAULT 1,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Vragen (inclusief Slide met informaties)
    CREATE TABLE IF NOT EXISTS vragen (
      id TEXT PRIMARY KEY,
      examen_id TEXT NOT NULL,
      vraag_tekst TEXT NOT NULL,
      afbeelding_url TEXT,
      is_info INTEGER DEFAULT 0,
      volgorde INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (examen_id) REFERENCES examens(id) ON DELETE CASCADE
    );

    -- Antwoord opties
    CREATE TABLE IF NOT EXISTS antwoord_opties (
      id TEXT PRIMARY KEY,
      vraag_id TEXT NOT NULL,
      label TEXT NOT NULL,
      tekst TEXT NOT NULL,
      is_correct INTEGER DEFAULT 0,
      FOREIGN KEY (vraag_id) REFERENCES vragen(id) ON DELETE CASCADE
    );

    -- Kandidaat-Examen toewijzing
    CREATE TABLE IF NOT EXISTS kandidaat_examen (
      id TEXT PRIMARY KEY,
      kandidaat_id TEXT NOT NULL,
      examen_id TEXT NOT NULL,
      inlogcode TEXT UNIQUE NOT NULL,
      wachtwoord_hash TEXT NOT NULL,
      tijdlimiet INTEGER,
      status TEXT DEFAULT 'niet_gestart' CHECK(status IN ('niet_gestart', 'bezig', 'beeindigd')),
      gestart DATETIME,
      beeindigd DATETIME,
      fraud_count INTEGER DEFAULT 0,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kandidaat_id) REFERENCES users(id),
      FOREIGN KEY (examen_id) REFERENCES examens(id)
    );

    -- Gegeven antwoorden
    CREATE TABLE IF NOT EXISTS antwoorden (
      id TEXT PRIMARY KEY,
      kandidaat_examen_id TEXT NOT NULL,
      vraag_id TEXT NOT NULL,
      gegeven_antwoord TEXT,
      is_correct INTEGER DEFAULT 0,
      tijdstip DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kandidaat_examen_id) REFERENCES kandidaat_examen(id) ON DELETE CASCADE,
      FOREIGN KEY (vraag_id) REFERENCES vragen(id)
    );

    -- Resultaten
    CREATE TABLE IF NOT EXISTS resultaten (
      id TEXT PRIMARY KEY,
      kandidaat_examen_id TEXT UNIQUE NOT NULL,
      totaal_vragen INTEGER,
      goed INTEGER,
      score_percentage REAL,
      geslaagd INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kandidaat_examen_id) REFERENCES kandidaat_examen(id) ON DELETE CASCADE
    );

    -- Docent beoordelingen (open vragen)
    CREATE TABLE IF NOT EXISTS docent_beoordelingen (
      id TEXT PRIMARY KEY,
      antwoord_id TEXT NOT NULL,
      docent_id TEXT NOT NULL,
      score REAL DEFAULT 0,
      feedback TEXT,
      beoordeeld_op DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (antwoord_id) REFERENCES antwoorden(id) ON DELETE CASCADE,
      FOREIGN KEY (docent_id) REFERENCES users(id)
    );

    -- Fraud logs
    CREATE TABLE IF NOT EXISTS fraud_logs (
      id TEXT PRIMARY KEY,
      kandidaat_examen_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      tijdstip DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kandidaat_examen_id) REFERENCES kandidaat_examen(id) ON DELETE CASCADE
    );

    -- Indexes voor performance
    CREATE INDEX IF NOT EXISTS idx_vragen_examen ON vragen(examen_id);
    CREATE INDEX IF NOT EXISTS idx_opties_vraag ON antwoord_opties(vraag_id);
    CREATE INDEX IF NOT EXISTS idx_ke_kandidaat ON kandidaat_examen(kandidaat_id);
    CREATE INDEX IF NOT EXISTS idx_ke_examen ON kandidaat_examen(examen_id);
    CREATE INDEX IF NOT EXISTS idx_antwoorden_ke ON antwoorden(kandidaat_examen_id);
    CREATE INDEX IF NOT EXISTS idx_fraud_ke ON fraud_logs(kandidaat_examen_id);
  `);

  console.log("Database schema initialized");
}

// Default admin aanmaken
function createDefaultAdmin() {
  const bcrypt = require("bcryptjs");
  const { v4: uuidv4 } = require("uuid");

  const existing = db
    .prepare("SELECT id FROM users WHERE role = ?")
    .get("admin");
  if (!existing) {
    const id = uuidv4();
    const hash = bcrypt.hashSync(
      process.env.ADMIN_DEFAULT_PASS || "admin123",
      10
    );
    db.prepare(
      `
      INSERT INTO users (id, naam, username, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(id, "Administrator", "admin", hash, "admin");
    console.log("Default admin created: admin / admin123");
  }
}

initSchema();
createDefaultAdmin();

module.exports = { db, initSchema };
