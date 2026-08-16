import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderNotification } from "../src/services/notifications/render";

describe("prediction_scored notification rendering", () => {
  it("renders exact score prediction result with +3 pts and Saudi dialect Arabic", () => {
    const rendered = renderNotification("prediction_scored", {
      matchId: "match-123",
      homeEn: "Saudi Arabia",
      homeAr: "السعودية",
      awayEn: "Egypt",
      awayAr: "مصر",
      pointsAwarded: 3,
      outcome: "exact",
    });

    assert.equal(rendered.titleEn, "Prediction result");
    assert.equal(rendered.titleAr, "نتيجة توقّعك");
    assert.match(rendered.bodyEn!, /You earned 3 pts on Saudi Arabia vs Egypt — exact score!/);
    assert.match(rendered.bodyAr!, /كسبت 3 نقاط على السعودية و مصر — جبت النتيجة بالملّي! 🎯/);
    assert.equal(rendered.ctaUrl, "/match/match-123");
    assert.equal(rendered.ctaLabelEn, "View Match");
    assert.equal(rendered.ctaLabelAr, "افتح المباراة");
  });

  it("renders correct winner prediction result with +1 pt", () => {
    const rendered = renderNotification("prediction_scored", {
      matchId: "match-456",
      homeEn: "Al Hilal",
      homeAr: "الهلال",
      awayEn: "Al Nassr",
      awayAr: "النصر",
      pointsAwarded: 1,
      outcome: "winner",
    });

    assert.match(rendered.bodyEn!, /You earned 1 pt on Al Hilal vs Al Nassr — correct winner\./);
    assert.match(rendered.bodyAr!, /كسبت 1 نقطة على الهلال و النصر — خمّنت الفايز صح!/);
    assert.equal(rendered.ctaUrl, "/match/match-456");
  });

  it("renders incorrect prediction result with 0 points", () => {
    const rendered = renderNotification("prediction_scored", {
      matchId: "match-789",
      homeEn: "Al Ittihad",
      homeAr: "الاتحاد",
      awayEn: "Al Shabab",
      awayAr: "الشباب",
      pointsAwarded: 0,
      outcome: "incorrect",
    });

    assert.match(rendered.bodyEn!, /No points on Al Ittihad vs Al Shabab this time\./);
    assert.match(rendered.bodyAr!, /ما كسبت نقاط على الاتحاد و الشباب هالمرة\. الجايات أكثر!/);
    assert.equal(rendered.ctaUrl, "/match/match-789");
  });
});
