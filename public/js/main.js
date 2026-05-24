// Examum – Main JavaScript
// Geen inline event handlers; alles via addEventListener (CSP-compliant)

document.addEventListener("DOMContentLoaded", function () {
  // ============================================
  // AUTO-HIDE ALERTS
  // ============================================
  document.querySelectorAll(".alert").forEach(function (alert) {
    setTimeout(function () {
      alert.style.opacity = "0";
      setTimeout(function () {
        alert.remove();
      }, 300);
    }, 5000);
  });

  // ============================================
  // BEVESTIGING BIJ GEVAARLIJKE KNOPPEN
  // ============================================
  document.querySelectorAll("form").forEach(function (form) {
    var btn = form.querySelector("button.btn-danger, button.btn-warning");
    if (!btn) return;
    form.addEventListener("submit", function (e) {
      var msg = btn.dataset.confirm || "Weet je het zeker?";
      if (!confirm(msg)) e.preventDefault();
    });
  });

  // ============================================
  // EXAMEN PAGINA
  // ============================================
  initExamenPagina();
});

function initExamenPagina() {
  var paginaEl = document.querySelector(".examen-page");
  if (!paginaEl) return;

  var vraagId = paginaEl.dataset.vraagId;

  // --- Timer ---
  var overSec = parseInt(paginaEl.dataset.overSec, 10) || 0;
  initTimer(overSec);

  // --- Meerkeuzevragen ---
  initMultipleChoice(vraagId);

  // --- Open vraag ---
  initOpenVraag(vraagId);

  // --- Fraud overlay sluit-knop ---
  var sluitBtn = document.getElementById("fraud-overlay-sluit");
  if (sluitBtn) {
    sluitBtn.addEventListener("click", function () {
      document.getElementById("fraud-overlay").style.display = "none";
    });
  }

  // --- Inleveren knop ---
  var inleverBtn = document.getElementById("btn-inleveren");
  if (inleverBtn) {
    inleverBtn.addEventListener("click", function () {
      inleveren(overSec);
    });
  }

  // --- Bookmark knop ---
  var bookmarkBtn = document.getElementById("btn-bookmark");
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener("click", function () {
      var nr = paginaEl.dataset.vraagNr;
      alert("Vraag " + nr + " gemarkeerd voor review");
    });
  }

  // --- Vorige/Volgende: sla open antwoord op voor navigatie ---
  initNavigatieOpslaan(vraagId);

  // --- Anti-fraud ---
  initAntiFraud();
}

// ============================================
// TIMER
// ============================================
var timerInterval;
var timerOver = 0;

function initTimer(overSec) {
  timerOver = overSec;
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  var timerEl = document.getElementById("timer");
  if (!timerEl) return;

  if (timerOver <= 0) {
    clearInterval(timerInterval);
    timerEl.textContent = "00:00";
    timerEl.classList.add("timer-danger");
    setTimeout(function () {
      window.location.href = "/examen/inleveren";
    }, 3000);
    return;
  }

  var m = Math.floor(timerOver / 60);
  var s = timerOver % 60;
  timerEl.textContent =
    String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");

  if (timerOver < 300) timerEl.classList.add("timer-warning");
  if (timerOver < 60) timerEl.classList.add("timer-danger");

  timerOver--;
}

// ============================================
// Meerkeuzevragen – event listeners op radio's
// ============================================
function initMultipleChoice(vraagId) {
  var container = document.querySelector(".antwoord-opties");
  if (!container || !vraagId) return;

  container.querySelectorAll('input[type="radio"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      opslaanAntwoord(vraagId, this.value);
    });
  });
}

function opslaanAntwoord(vraagId, antwoord) {
  fetch("/examen/antwoord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vraag_id: vraagId, antwoord: antwoord }),
  })
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      if (!data.success) return;
      // Visuele feedback: highlight geselecteerde optie
      document
        .querySelectorAll(".antwoord-opties .optie-label")
        .forEach(function (el) {
          el.classList.remove("selected");
        });
      var sel = document.querySelector(
        '.antwoord-opties .optie-label[data-label="' + antwoord + '"]'
      );
      if (sel) sel.classList.add("selected");
    })
    .catch(function () {});
}

// ============================================
// Open vraag – opslaan bij input (debounced) + bij navigatie
// ============================================
var saveTimeout = null;
var isSaving = false;

function initOpenVraag(vraagId) {
  var textarea = document.getElementById("open-antwoord");
  if (!textarea || !vraagId) return;

  // Opslaan terwijl je typt (debounced, 800ms)
  textarea.addEventListener("input", function () {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(function () {
      opslaanOpenAntwoord(vraagId, textarea.value);
    }, 800);
  });

  // Ook direct opslaan bij blur (tabben / klikken buiten)
  textarea.addEventListener("blur", function () {
    clearTimeout(saveTimeout);
    opslaanOpenAntwoord(vraagId, textarea.value);
  });
}

function opslaanOpenAntwoord(vraagId, antwoord) {
  var textarea = document.getElementById("open-antwoord");
  return fetch("/examen/antwoord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vraag_id: vraagId, antwoord: antwoord }),
  })
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      if (data.success && textarea) {
        textarea.style.borderColor = "#38a169";
        setTimeout(function () {
          textarea.style.borderColor = "";
        }, 1000);
      }
    })
    .catch(function () {});
}

// ============================================
// NAVIGATIE – sla open antwoord op VOOR het navigeren
// Voorkomt dat antwoord verloren gaat bij "Vorige"/"Volgende"
// ============================================
function initNavigatieOpslaan(vraagId) {
  var textarea = document.getElementById("open-antwoord");
  if (!textarea || !vraagId) return;

  // Onderschep alle navigatielinks op de pagina
  document.querySelectorAll("a.btn-nav").forEach(function (link) {
    if (link.classList.contains("disabled")) return;
    link.addEventListener("click", function (e) {
      var href = this.href;
      if (!href || href === "#") return;

      var huidig = textarea.value;
      // Als er niks gewijzigd is, gewoon navigeren
      // Sla op en navigeer dan pas
      e.preventDefault();
      clearTimeout(saveTimeout);
      opslaanOpenAntwoord(vraagId, huidig)
        .then(function () {
          window.location.href = href;
        })
        .catch(function () {
          window.location.href = href; // navigeer sowieso
        });
    });
  });
}

// ============================================
// INLEVEREN
// ============================================
function inleveren(overSec) {
  if (overSec !== undefined && overSec <= 0) {
    window.location.href = "/examen/inleveren";
    return;
  }

  var textarea = document.getElementById("open-antwoord");
  var paginaEl = document.querySelector(".examen-page");
  var vraagId = paginaEl ? paginaEl.dataset.vraagId : null;

  function doInleveren() {
    if (
      !confirm(
        "Weet je zeker dat je het examen wilt inleveren? Dit kan niet ongedaan worden gemaakt."
      )
    )
      return;
    fetch("/examen/inleveren", { method: "POST" })
      .then(function () {
        window.location.href = "/examen/resultaat";
      })
      .catch(function () {
        window.location.href = "/examen/resultaat";
      });
  }

  // Als er een open antwoord is, eerst opslaan dan inleveren
  if (textarea && vraagId) {
    clearTimeout(saveTimeout);
    opslaanOpenAntwoord(vraagId, textarea.value)
      .then(doInleveren)
      .catch(doInleveren);
  } else {
    doInleveren();
  }
}

// ============================================
// ANTI-FRAUD
// ============================================
var fraudCount = 0;

function initAntiFraud() {
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      fraudCount++;
      document.getElementById("fraud-indicator") &&
        (document.getElementById("fraud-indicator").style.display = "inline");
      if (fraudCount >= 2) {
        var overlay = document.getElementById("fraud-overlay");
        if (overlay) overlay.style.display = "flex";
      }
      fetch("/api/fraud/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "tab_switch",
          event_data: { count: fraudCount },
        }),
      }).catch(function () {});
    }
  });

  document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });
  document.addEventListener("copy", function (e) {
    e.preventDefault();
  });
  document.addEventListener("paste", function (e) {
    e.preventDefault();
  });

  document.addEventListener("keydown", function (e) {
    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && e.key === "I") ||
      (e.ctrlKey && e.key === "u") ||
      (e.ctrlKey && e.key === "s") ||
      (e.ctrlKey && e.key === "p")
    ) {
      e.preventDefault();
    }
  });
}

// ============================================
// ADMIN: PRINT KNOP
// ============================================
document.addEventListener("DOMContentLoaded", function () {
  var printBtn = document.getElementById("btn-print");
  if (printBtn) {
    printBtn.addEventListener("click", function () {
      window.print();
    });
  }
});

// ============================================
// ADMIN: TAB SWITCHING (kandidaten pagina)
// ============================================
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tabName = this.getAttribute("data-tab");
      document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.remove("active");
      });
      document.querySelectorAll(".tab-content").forEach(function (c) {
        c.classList.remove("active");
      });
      this.classList.add("active");
      var target = document.getElementById("tab-" + tabName);
      if (target) target.classList.add("active");
    });
  });
});
