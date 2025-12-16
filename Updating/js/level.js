// js/level.js
(function (w) {

  let currentLevel = "easy"; // default

  function setLevel(level) {
    currentLevel = level;
  }

  function getLevel() {
    return currentLevel;
  }

  // Ayat selection only (mode independent)
  function pickAyat(selectedAyats, randomIndexFn) {
    if (!selectedAyats || !selectedAyats.length) return null;

    if (currentLevel === "easy") {
      return selectedAyats[0]; // FIRST ayat
    }

    if (currentLevel === "hard") {
      return selectedAyats[selectedAyats.length - 1]; // LAST ayat
    }

    // medium
    const i = randomIndexFn();
    return selectedAyats[i];
  }

  function getHintLimit() {
    if (currentLevel === "easy") return 3;
    if (currentLevel === "medium") return 2;
    return 1; // hard
  }

  function getScorePerCorrect() {
    return currentLevel === "hard" ? 2 : 1;
  }

  w.Level = {
    setLevel,
    getLevel,
    pickAyat,
    getHintLimit,
    getScorePerCorrect
  };

})(window);
