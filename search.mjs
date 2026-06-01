function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreRecord(record, terms) {
  const fields = [
    [record.question, 8],
    [record.answer, 5],
    [record.type, 3],
    [record.followUp, 2],
    [record.note, 1]
  ];

  let score = 0;
  for (const term of terms) {
    for (const [value, weight] of fields) {
      const text = normalize(value);
      if (!text) continue;
      if (text === term) score += weight * 4;
      else if (text.includes(term)) score += weight;
    }
  }
  return score;
}

export function searchKnowledgeBase(payload, { query = "", category = "全部" } = {}) {
  const records = Array.isArray(payload.records) ? payload.records : [];
  const terms = normalize(query).split(/[ ,，。；;、]+/).filter(Boolean);
  const selectedCategory = category && category !== "全部" ? category : "";

  const results = [];
  for (const record of records) {
    if (selectedCategory && record.type !== selectedCategory) continue;
    const score = terms.length ? scoreRecord(record, terms) : 1;
    if (score > 0) results.push({ ...record, score });
  }

  return results
    .sort((left, right) => right.score - left.score || left.question.localeCompare(right.question, "zh-Hans-CN"))
    .slice(0, 30);
}
