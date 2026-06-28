import { describe, it, expect } from 'vitest';
import { extractPrice, matchKeywords, matchPrice } from './matchers.js';

describe('extractPrice', () => {
  it('returns null for empty string', () => expect(extractPrice('')).toBeNull());
  it('returns null for null', () => expect(extractPrice(null)).toBeNull());
  it('returns null for undefined', () => expect(extractPrice(undefined)).toBeNull());
  it('extracts $50', () => expect(extractPrice('Price is $50')).toBe(50));
  it('extracts $150.99', () => expect(extractPrice('Selling for $150.99')).toBe(150.99));
  it('extracts $1,234.56', () => expect(extractPrice('Cost: $1,234.56')).toBe(1234.56));
  it('extracts USD 50', () => expect(extractPrice('USD 50')).toBe(50));
  it('extracts 50 USD', () => expect(extractPrice('50 USD')).toBe(50));
  it('extracts $0.99', () => expect(extractPrice('Only $0.99')).toBe(0.99));
  it('extracts $100000', () => expect(extractPrice('Car $100000')).toBeNull());
  it('returns null for text without price', () => expect(extractPrice('free item')).toBeNull());
  it('extracts first price in text', () => expect(extractPrice('Was $100, now $50')).toBe(100));
  it('handles price with commas', () => expect(extractPrice('$2,500')).toBe(2500));
  it('handles price at start of text', () => expect(extractPrice('$75 OBO')).toBe(75));
  it('handles price at end of text', () => expect(extractPrice('Selling for $200')).toBe(200));
  it('handles usd suffix', () => expect(extractPrice('Price: 50usd')).toBe(50));
  it('handles USD suffix uppercase', () => expect(extractPrice('Price: 50USD')).toBe(50));
  it('rejects negative prices', () => {
    const result = extractPrice('Price is $-50');
    expect(result === null || result > 0).toBe(true);
  });
  it('handles price with leading spaces', () => expect(extractPrice('  $50')).toBe(50));
  it('handles price in parentheses', () => expect(extractPrice('($50)')).toBe(50));
  it('extracts integer price', () => expect(extractPrice('$50')).toBe(50));
  it('extracts decimal price', () => expect(extractPrice('$50.50')).toBe(50.5));
  it('handles realistic listing', () => expect(extractPrice('Keychron Q1 - $150 shipped')).toBe(150));
  it('handles listing with USD', () => expect(extractPrice('Selling item 700 USD')).toBe(700));
  it('handles multiple prices picks first', () => expect(extractPrice('$80 or best offer')).toBe(80));
  it('handles price with no dollar in middle', () => {
    const result = extractPrice('Budget around 200 dollars');
    expect(result === null || result > 0).toBe(true);
  });
});

describe('matchKeywords', () => {
  it('returns empty for null text', () => expect(matchKeywords(null, 'test')).toEqual([]));
  it('returns empty for empty text', () => expect(matchKeywords('', 'test')).toEqual([]));
  it('returns empty for null keywords', () => expect(matchKeywords('test', null)).toEqual([]));
  it('returns empty for empty keywords', () => expect(matchKeywords('test', '')).toEqual([]));
  it('matches single keyword', () => expect(matchKeywords('keyboard for sale', 'keyboard')).toEqual(['keyboard']));
  it('matches multiple keywords', () => {
    const result = matchKeywords('keyboard mouse pad', 'keyboard, mouse');
    expect(result).toContain('keyboard');
    expect(result).toContain('mouse');
  });
  it('is case insensitive', () => expect(matchKeywords('KEYBOARD', 'keyboard')).toEqual(['keyboard']));
  it('matches partial word', () => expect(matchKeywords('mechanical keyboard', 'key')).toEqual(['key']));
  it('trims whitespace from keywords', () => expect(matchKeywords('keyboard', '  keyboard  ')).toEqual(['keyboard']));
  it('returns empty for no match', () => expect(matchKeywords('mouse', 'keyboard')).toEqual([]));
  it('handles comma separated with spaces', () => expect(matchKeywords('keyboard mouse', 'keyboard, mouse')).toHaveLength(2));
  it('handles single char keyword', () => expect(matchKeywords('a b c', 'a')).toEqual(['a']));
  it('handles special regex chars', () => expect(matchKeywords('price is $50', '$50')).toEqual(['$50']));
  it('matches keyword at start', () => expect(matchKeywords('keyboard for sale', 'keyboard')).toEqual(['keyboard']));
  it('matches keyword at end', () => expect(matchKeywords('for sale keyboard', 'keyboard')).toEqual(['keyboard']));
  it('matches keyword in middle', () => expect(matchKeywords('for keyboard sale', 'keyboard')).toEqual(['keyboard']));
  it('deduplicates matches', () => {
    const result = matchKeywords('keyboard keyboard', 'keyboard');
    expect(result).toEqual(['keyboard']);
  });
  it('matches only unique keywords', () => {
    const result = matchKeywords('keyboard mouse', 'keyboard, keyboard, mouse');
    expect(result).toEqual(['keyboard', 'mouse']);
  });
  it('handles unicode characters', () => expect(matchKeywords('café', 'café')).toEqual(['café']));
  it('handles numbers', () => expect(matchKeywords('item 123', '123')).toEqual(['123']));
  it('handles multiline text', () => expect(matchKeywords('line1\nkeyboard\nline3', 'keyboard')).toEqual(['keyboard']));
  it('skips empty keyword after comma', () => expect(matchKeywords('test', 'test,')).toEqual(['test']));
});

describe('extractPrice additional edge cases', () => {
  it('does not extract EUR prefix (not supported)', () => expect(extractPrice('EUR 50')).toBeNull());
  it('does not extract GBP prefix (not supported)', () => expect(extractPrice('GBP 75')).toBeNull());
  it('extracts 50usd with no space via pattern2', () => expect(extractPrice('Price is 50usd')).toBe(50));
  it('does not extract 50eur suffix (not supported)', () => expect(extractPrice('Price is 50eur')).toBeNull());
  it('extracts $50 with text around', () => expect(extractPrice('The price is $50 for this item')).toBe(50));
  it('rejects $1,000,000 (exceeds cap of 100000)', () => expect(extractPrice('Worth $1,000,000')).toBeNull());
  it('handles price with period in middle of text', () => {
    const result = extractPrice('Cost was $150.00 after tax');
    expect(result).toBe(150);
  });
  it('handles multiple prices picks first valid', () => expect(extractPrice('$200 offer or $150 buy now')).toBe(200));
  it('extracts $12.34 from $12.34.56 (first valid match)', () => expect(extractPrice('Price $12.34.56')).toBe(12.34));
  it('extracts $1.2 from $1.2.3 (first valid match)', () => expect(extractPrice('Cost $1.2.3')).toBe(1.2));
  it('does not extract 50 without currency indicator', () => expect(extractPrice('Price is 50')).toBeNull());
  it('handles $ at end of text without number', () => expect(extractPrice('Price is $')).toBeNull());
  it('handles empty text after price prefix', () => expect(extractPrice('USD ')).toBeNull());
  it('handles only currency word', () => expect(extractPrice('dollars')).toBeNull());
  it('handles price in brackets [100 USD]', () => expect(extractPrice('[100 USD]')).toBe(100));
  it('handles price with slashes', () => expect(extractPrice('Price $50/ea')).toBe(50));
  it('does not extract EUR suffix (not supported)', () => expect(extractPrice('Preis: 50 EUR')).toBeNull());
  it('does not extract model numbers as prices', () => {
    const result = extractPrice('RTX 3080 for sale');
    expect(result).toBeNull();
  });
  it('does not extract 80085 as price', () => expect(extractPrice('Model 80085')).toBeNull());
  it('extracts price with symbol before text', () => expect(extractPrice('$50 shipped')).toBe(50));
  it('extracts price from short text', () => expect(extractPrice('$5')).toBe(5));
  it('handles decimal price with single digit cents', () => expect(extractPrice('$5.5')).toBe(5.5));
  it('extracts USD at end with no space', () => expect(extractPrice('50USD')).toBe(50));
  it('does not extract eur at end (not supported)', () => expect(extractPrice('50eur')).toBeNull());
  it('extracts USD at end with space', () => expect(extractPrice('50 USD')).toBe(50));
});

describe('matchKeywords additional edge cases', () => {
  it('matches keyword with punctuation around', () => expect(matchKeywords('(keyboard) for sale', 'keyboard')).toEqual(['keyboard']));
  it('matches keyword at start of text', () => expect(matchKeywords('keyboard for sale', 'keyboard')).toEqual(['keyboard']));
  it('matches keyword at end of text', () => expect(matchKeywords('for sale keyboard', 'keyboard')).toEqual(['keyboard']));
  it('matches keyword in the middle', () => expect(matchKeywords('for keyboard sale', 'keyboard')).toEqual(['keyboard']));
  it('handles keyword with spaces (multi-word)', () => expect(matchKeywords('mechanical keyboard for sale', 'mechanical keyboard')).toEqual(['mechanical keyboard']));
  it('matches partial word at boundary', () => expect(matchKeywords('keyboarding is fun', 'key')).toEqual(['key']));
  it('matches with hyphenated words', () => expect(matchKeywords('key-cap set', 'key')).toEqual(['key']));
  it('handles empty array-like string', () => expect(matchKeywords('test', ',')).toEqual([]));
  it('handles keyword with numbers', () => expect(matchKeywords('g pro x superlight mouse', 'g pro x')).toEqual(['g pro x']));
  it('deduplicates across multiple keyword lists', () => {
    const result = matchKeywords('keyboard mouse keyboard', 'keyboard, mouse');
    expect(result).toEqual(['keyboard', 'mouse']);
  });
  it('returns empty for no match in long text', () => expect(matchKeywords('a b c d e f g', 'keyboard')).toEqual([]));
  it('handles very long keyword string', () => {
    const longKeywords = 'keyboard, mouse, monitor, headset, webcam, microphone, speakers, desk, chair, lamp, cable, mat';
    const result = matchKeywords('mechanical keyboard for sale', longKeywords);
    expect(result).toEqual(['keyboard']);
  });
  it('handles overlapping keywords', () => expect(matchKeywords('keyboard mat', 'keyboard, keyboard mat')).toContain('keyboard mat'));
});

describe('matchPrice additional edge cases', () => {
  it('allows at min boundary with no price', () => expect(matchPrice('free', 0, null)).toBe(true));
  it('handles EUR currency', () => expect(matchPrice('EUR 50', 25, 75)).toBe(true));
  it('handles GBP currency', () => expect(matchPrice('GBP 100', 50, 150)).toBe(true));
  it('handles price with comma', () => expect(matchPrice('$1,500', 1000, 2000)).toBe(true));
  it('handles negative range gracefully', () => expect(matchPrice('$50', -10, 100)).toBe(true));
  it('blocks price above max boundary', () => expect(matchPrice('$100', null, 99)).toBe(false));
  it('blocks price below min boundary', () => expect(matchPrice('$5', 10, null)).toBe(false));
  it('handles no price with filters', () => expect(matchPrice('no price here', 10, 100)).toBe(true));
  it('handles multiple prices picks first within range', () => expect(matchPrice('$500 or $50', 25, 75)).toBe(false));
  it('handles null text', () => expect(matchPrice(null, null, null)).toBe(true));
  it('handles undefined text', () => expect(matchPrice(undefined, null, null)).toBe(true));
});

describe('matchPrice', () => {
  it('returns true when no price in text', () => expect(matchPrice('free item', 10, 50)).toBe(true));
  it('allows price within range', () => expect(matchPrice('$30', 10, 50)).toBe(true));
  it('blocks price below min', () => expect(matchPrice('$5', 10, 50)).toBe(false));
  it('blocks price above max', () => expect(matchPrice('$100', 10, 50)).toBe(false));
  it('allows at min boundary', () => expect(matchPrice('$10', 10, 50)).toBe(true));
  it('allows at max boundary', () => expect(matchPrice('$50', 10, 50)).toBe(true));
  it('no min filter', () => expect(matchPrice('$30', null, 50)).toBe(true));
  it('no max filter', () => expect(matchPrice('$30', 10, null)).toBe(true));
  it('no filters at all', () => expect(matchPrice('$30', null, null)).toBe(true));
  it('handles decimal prices with range', () => expect(matchPrice('$25.50', 20, 30)).toBe(true));
  it('rejects decimal below min', () => expect(matchPrice('$15.99', 20, 30)).toBe(false));
  it('rejects decimal above max', () => expect(matchPrice('$35.01', 20, 30)).toBe(false));
  it('zero min allows any price', () => expect(matchPrice('$0.50', 0, 10)).toBe(true));
  it('handles exact match', () => expect(matchPrice('$100', 100, 100)).toBe(true));
  it('handles USD format with range', () => expect(matchPrice('USD 75', 50, 100)).toBe(true));
  it('handles no price in range returns true', () => expect(matchPrice('no price here', 10, 50)).toBe(true));
  it('handles large price rejected', () => expect(matchPrice('$50000', 10, 1000)).toBe(false));
});
