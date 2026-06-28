export function extractPrice(text) {
  if (!text) return null;

  const pattern1 = /(?:(\$|USD|usd)\s*)?\b(\d+(?:,\d{3})*(?:\.\d{1,2})?)\b(?:\s*(USD|usd))?/i;
  const m1 = text.match(pattern1);
  if (m1) {
    const prefix = m1[1];
    const numStr = m1[2];
    const suffix = m1[3];
    if (prefix || suffix) {
      const num = parseFloat(numStr.replace(/,/g, ''));
      if (!isNaN(num) && num > 0 && num < 100000) return num;
    }
  }

  const pattern2 = /\b(\d+(?:,\d{3})*(?:\.\d{1,2})?)(usd|USD)/;
  const m2 = text.match(pattern2);
  if (m2) {
    const num = parseFloat(m2[1].replace(/,/g, ''));
    if (!isNaN(num) && num > 0 && num < 100000) return num;
  }

  return null;
}

export function matchKeywords(text, keywordsStr) {
  if (!text || !keywordsStr) return [];
  const keywords = keywordsStr.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  const uniqueKeywords = [...new Set(keywords)];
  const lowerText = text.toLowerCase();
  return uniqueKeywords.filter(kw => lowerText.includes(kw));
}

export function matchPrice(text, minPrice, maxPrice) {
  const price = extractPrice(text);
  if (price === null) return true;
  if (minPrice != null && price < minPrice) return false;
  if (maxPrice != null && price > maxPrice) return false;
  return true;
}
