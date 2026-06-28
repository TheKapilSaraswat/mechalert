import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
      get: vi.fn(() => ({ c: 0 })),
      all: vi.fn(() => []),
    })),
  },
}));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import { basicParse } from './llmSearch.js';

function check(query, expected) {
  const result = basicParse(query);
  for (const [key, val] of Object.entries(expected)) {
    if (val === undefined) {
      expect(result[key]).toBeUndefined();
    } else {
      expect(result[key]).toBe(val);
    }
  }
}

describe('basicParse - max price patterns', () => {
  it.each([
    ['keyboard under 100', { max_price: 100 }],
    ['keyboard under $100', { max_price: 100 }],
    ['gpu below 200', { max_price: 200 }],
    ['gpu below $200', { max_price: 200 }],
    ['monitor less than 150', { max_price: 150 }],
    ['monitor less than $150', { max_price: 150 }],
    ['headphones < 50', { max_price: 50 }],
    ['headphones <$50', { max_price: 50 }],
    ['phone max 500', { max_price: 500 }],
    ['phone max $500', { max_price: 500 }],
    ['tablet up to 300', { max_price: 300 }],
    ['tablet up to $300', { max_price: 300 }],
    ['laptop at most 1000', { max_price: 1000 }],
    ['laptop at most $1000', { max_price: 1000 }],
    ['budget 200 monitor', { max_price: 200 }],
    ['budget $200 monitor', { max_price: 200 }],
    ['keyboard under 100$', { max_price: 100 }],
    ['mouse under 50€', { max_price: 50 }],
    ['gpu under 200£', { max_price: 200 }],
  ])('parses max price: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - min price patterns', () => {
  it.each([
    ['gpu over 500', { min_price: 500 }],
    ['gpu over $500', { min_price: 500 }],
    ['keyboard above 100', { min_price: 100 }],
    ['keyboard above $100', { min_price: 100 }],
    ['monitor more than 200', { min_price: 200 }],
    ['monitor more than $200', { min_price: 200 }],
    ['camera > 300', { min_price: 300 }],
    ['camera >$300', { min_price: 300 }],
    ['laptop min 400', { min_price: 400 }],
    ['laptop min $400', { min_price: 400 }],
    ['phone at least 200', { min_price: 200 }],
    ['phone at least $200', { min_price: 200 }],
    ['starting at 50 keyboard', { min_price: 50 }],
    ['starting at $50 keyboard', { min_price: 50 }],
    ['camera over 200$', { min_price: 200 }],
    ['laptop above 100€', { min_price: 100 }],
    ['phone over 300£', { min_price: 300 }],
  ])('parses min price: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - range patterns', () => {
  it.each([
    ['100-200 keyboard', { min_price: 100, max_price: 200 }],
    ['$100-200 keyboard', { min_price: 100, max_price: 200 }],
    ['$100-$200 keyboard', { min_price: 100, max_price: 200 }],
    ['100 to 200 keyboard', { min_price: 100, max_price: 200 }],
    ['100 to $200 keyboard', { min_price: 100, max_price: 200 }],
    ['monitor $200-$400', { min_price: 200, max_price: 400 }],
    ['gpu 500-1000', { min_price: 500, max_price: 1000 }],
    ['phone 300 to 600', { min_price: 300, max_price: 600 }],
    ['laptop 500-1500', { min_price: 500, max_price: 1500 }],
    ['headphones 50-100', { min_price: 50, max_price: 100 }],
    ['tablet 200-500', { min_price: 200, max_price: 500 }],
    ['chair 100-300', { min_price: 100, max_price: 300 }],
    ['mouse 20-50', { min_price: 20, max_price: 50 }],
    ['keyboard $50-$150', { min_price: 50, max_price: 150 }],
    ['gpu $300-$800', { min_price: 300, max_price: 800 }],
  ])('parses range: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - source patterns', () => {
  it.each([
    ['keyboard on reddit', { source: 'reddit' }],
    ['keyboard from reddit', { source: 'reddit' }],
    ['laptop on craigslist', { source: 'craigslist' }],
    ['laptop from craigslist', { source: 'craigslist' }],
    ['phone on reddit under 300', { source: 'reddit', max_price: 300 }],
    ['gpu from craigslist over 200', { source: 'craigslist', min_price: 200 }],
    ['100-200 keyboard on reddit', { source: 'reddit', min_price: 100, max_price: 200 }],
    ['camera $200-$400 from craigslist', { source: 'craigslist', min_price: 200, max_price: 400 }],
    ['keyboard on reddit under 100', { source: 'reddit', max_price: 100 }],
    ['laptop from craigslist 500-1000', { source: 'craigslist', min_price: 500, max_price: 1000 }],
  ])('parses source: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - combined patterns', () => {
  it.each([
    ['keyboard under 100 on reddit', { max_price: 100, source: 'reddit' }],
    ['gpu over 500 from craigslist', { min_price: 500, source: 'craigslist' }],
    ['laptop 500-1000 on reddit', { min_price: 500, max_price: 1000, source: 'reddit' }],
    ['monitor under 200 on craigslist', { max_price: 200, source: 'craigslist' }],
    ['phone above 300 on reddit', { min_price: 300, source: 'reddit' }],
    ['camera 100 to 300 from craigslist', { min_price: 100, max_price: 300, source: 'craigslist' }],
    ['keyboard over 50 under 200', { min_price: 50, max_price: 200 }],
    ['gpu min 300 max 800', { min_price: 300, max_price: 800 }],
    ['monitor above 100 below 400', { min_price: 100, max_price: 400 }],
    ['phone over 200 less than 600', { min_price: 200, max_price: 600 }],
    ['laptop at least 500 up to 1500', { min_price: 500, max_price: 1500 }],
    ['keyboard over 50 under 200 on reddit', { min_price: 50, max_price: 200, source: 'reddit' }],
    ['gpu 300-800 from craigslist', { min_price: 300, max_price: 800, source: 'craigslist' }],
    ['monitor above 100 below 400 on reddit', { min_price: 100, max_price: 400, source: 'reddit' }],
    ['phone 200-600 from craigslist', { min_price: 200, max_price: 600, source: 'craigslist' }],
    ['laptop at least 500 up to 1500 on reddit', { min_price: 500, max_price: 1500, source: 'reddit' }],
    ['gmk keycaps under 200$', { keywords: 'gmk keycaps', max_price: 200 }],
    ['gmk keycaps under 200€', { keywords: 'gmk keycaps', max_price: 200 }],
    ['gmk keycaps under 200£', { keywords: 'gmk keycaps', max_price: 200 }],
    ['keycaps over 50$ under 200$', { keywords: 'keycaps', min_price: 50, max_price: 200 }],
  ])('parses combined: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - single word keywords', () => {
  it.each([
    ['keyboard', { keywords: 'keyboard' }],
    ['gaming', { keywords: 'gaming' }],
    ['laptop', { keywords: 'laptop' }],
    ['monitor', { keywords: 'monitor' }],
    ['phone', { keywords: 'phone' }],
    ['camera', { keywords: 'camera' }],
    ['headphones', { keywords: 'headphones' }],
    ['mouse', { keywords: 'mouse' }],
    ['chair', { keywords: 'chair' }],
    ['gpu', { keywords: 'gpu' }],
  ])('preserves keyword: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - multi-word keywords', () => {
  it.each([
    ['mechanical keyboard', { keywords: 'mechanical keyboard' }],
    ['gaming laptop', { keywords: 'gaming laptop' }],
    ['wireless mouse', { keywords: 'wireless mouse' }],
    ['usb hub', { keywords: 'usb hub' }],
    ['desk lamp', { keywords: 'desk lamp' }],
    ['coffee maker', { keywords: 'coffee maker' }],
    ['graphics card', { keywords: 'graphics card' }],
    ['ssd drive', { keywords: 'ssd drive' }],
    ['gaming chair', { keywords: 'gaming chair' }],
    ['standing desk', { keywords: 'standing desk' }],
  ])('preserves multi-word: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - realistic natural language queries', () => {
  it.each([
    ['i need a mechanical keyboard under 200', { max_price: 200 }],
    ['looking for a gpu on reddit over 500', { source: 'reddit', min_price: 500 }],
    ['show me laptops between 500 and 1000 on reddit', { source: 'reddit', min_price: 500, max_price: 1000 }],
    ['find me a cheap monitor on craigslist', { source: 'craigslist' }],
    ['best gaming chair under 300', { max_price: 300 }],
    ['deals on wireless mouse from reddit', { source: 'reddit' }],
    ['search for headphone deals under 100', { max_price: 100 }],
    ['i want a camera on craigslist under 500', { source: 'craigslist', max_price: 500 }],
    ['need a phone max 400 from reddit', { source: 'reddit', max_price: 400 }],
    ['find tablet deals on reddit 200-500', { source: 'reddit', min_price: 200, max_price: 500 }],
    ['show me the best keyboard deals', {}],
    ['looking for cheap monitor on reddit', { source: 'reddit' }],
    ['i want to find a gpu under 200', { max_price: 200 }],
    ['need a laptop for under 1000', { max_price: 1000 }],
    ['find deals on mechanical keyboards', {}],
    ['show me phones on reddit above 300', { source: 'reddit', min_price: 300 }],
    ['i am looking for a cheap mouse', {}],
    ['need a good monitor under 200', { max_price: 200 }],
    ['find me a deal on a gpu', {}],
    ['looking for gaming laptop on reddit under 1500', { source: 'reddit', max_price: 1500 }],
  ])('parses natural language: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - case sensitivity', () => {
  it.each([
    ['KEYBOARD UNDER 100', { max_price: 100 }],
    ['GPU Over 500', { min_price: 500 }],
    ['Monitor On Reddit', { source: 'reddit' }],
    ['Phone 100-200', { min_price: 100, max_price: 200 }],
    ['Laptop Under $1000', { max_price: 1000 }],
    ['Camera From Craigslist', { source: 'craigslist' }],
    ['Headphones Less Than 50', { max_price: 50 }],
    ['Tablet Max 400', { max_price: 400 }],
    ['Chair Budget 200', { max_price: 200 }],
    ['Mouse Starting At 30', { min_price: 30 }],
  ])('handles case insensitive: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - edge cases', () => {
  it.each([
    ['', {}],
    ['   ', {}],
    ['keyboard under', { keywords: 'keyboard' }],
    ['under 100', { max_price: 100 }],
    ['over 500', { min_price: 500 }],
    ['on reddit', { source: 'reddit' }],
    ['100-200', { min_price: 100, max_price: 200 }],
    ['100 to 200', { min_price: 100, max_price: 200 }],
    ['$50', {}],
    ['12345', {}],
    ['a', {}],
    ['ab', { keywords: 'ab' }],
  ])('handles edge case: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - special characters', () => {
  it.each([
    ['<script>alert(1)</script>', {}],
    ['keyboard @ $100', {}],
    ['gpu #1', {}],
    ['monitor!!', {}],
    ['camera (used)', {}],
    ['laptop - cheap', {}],
    ['phone / cell', {}],
    ['headphones [new]', {}],
    ['tablet {wanted}', {}],
    ['mouse | wireless', {}],
  ])('handles special chars: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - with extra stop words', () => {
  it.each([
    ['cheap keyboard', { keywords: 'keyboard' }],
    ['cheapest monitor', { keywords: 'monitor' }],
    ['best deal laptop', { keywords: 'laptop' }],
    ['find keyboard', { keywords: 'keyboard' }],
    ['search laptop', { keywords: 'laptop' }],
    ['show phone', { keywords: 'phone' }],
    ['deal find', {}],  // both are stop words, will be emptied
    ['the a an in of to with', {}],
    ['for and me', {}],
  ])('removes stop words: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - price edge cases', () => {
  it.each([
    ['keyboard under 0', { max_price: 0 }],
    ['gpu over 999999', { min_price: 999999 }],
    ['monitor $0-$100', { min_price: 0, max_price: 100 }],
    ['phone 0-50', { min_price: 0, max_price: 50 }],
    ['headphones cheapest', {}],
    ['tablet best deal', {}],
  ])('handles price edge cases: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - keywords contain no price or source noise', () => {
  it.each([
    ['keyboard under 100', { keywords: 'keyboard' }],
    ['gpu over 500', { keywords: 'gpu' }],
    ['monitor 100-200', { keywords: 'monitor' }],
    ['phone on reddit', { keywords: 'phone' }],
    ['laptop from craigslist', { keywords: 'laptop' }],
    ['camera under 200 on reddit', { keywords: 'camera' }],
    ['headphones over 50 from craigslist', { keywords: 'headphones' }],
    ['tablet 200-500 on reddit', { keywords: 'tablet' }],
    ['chair budget 300 from craigslist', { keywords: 'chair' }],
    ['mouse above 20 on reddit', { keywords: 'mouse' }],
  ])('clean keywords: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - max price with suffixes', () => {
  it.each([
    ['keyboard under 100 or less', { max_price: 100 }],
    ['gpu under 200 and under', { max_price: 200 }],
    ['monitor max 150 dollars', { max_price: 150 }],
    ['phone up to 500 bucks', { max_price: 500 }],
    ['laptop under 1000 usd', { max_price: 1000 }],
  ])('parses max with suffix: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - min price with suffixes', () => {
  it.each([
    ['gpu over 500 or more', { min_price: 500 }],
    ['keyboard above 100 and up', { min_price: 100 }],
    ['monitor more than 200 dollars', { min_price: 200 }],
    ['phone at least 300 usd', { min_price: 300 }],
    ['laptop min 400 bucks', { min_price: 400 }],
  ])('parses min with suffix: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - order variation', () => {
  it.each([
    ['under 100 keyboard', { max_price: 100 }],
    ['over 500 gpu', { min_price: 500 }],
    ['on reddit keyboard', { source: 'reddit' }],
    ['200-400 monitor', { min_price: 200, max_price: 400 }],
    ['from craigslist laptop under 300', { source: 'craigslist', max_price: 300 }],
    ['under 200 on reddit keyboard', { max_price: 200, source: 'reddit' }],
    ['over 100 from craigslist mouse', { min_price: 100, source: 'craigslist' }],
    ['100 to 300 on reddit camera', { min_price: 100, max_price: 300, source: 'reddit' }],
    ['max 800 on craigslist gpu over 300', { max_price: 800, min_price: 300, source: 'craigslist' }],
    ['less than 50 headphones on reddit', { max_price: 50, source: 'reddit' }],
  ])('handles order variation: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - product variations', () => {
  it.each([
    ['rtx 3080', { keywords: 'rtx 3080' }],
    ['ryzen 7', { keywords: 'ryzen 7' }],
    ['34 inch ultrawide', { keywords: '34 inch ultrawide' }],
    ['27 inch 1440p', { keywords: '27 inch 1440p' }],
    ['cherry mx blue', { keywords: 'cherry mx blue' }],
    ['corsair k70', { keywords: 'corsair k70' }],
    ['logitech g pro', { keywords: 'logitech g pro' }],
    ['samsung odyssey g7', { keywords: 'samsung odyssey g7' }],
    ['dell s2721dgf', { keywords: 'dell s2721dgf' }],
    ['thinkpad x1 carbon', { keywords: 'thinkpad x1 carbon' }],
    ['macbook pro m3', { keywords: 'macbook pro m3' }],
    ['ipad pro m4', { keywords: 'ipad pro m4' }],
    ['airpods pro 2', { keywords: 'airpods pro 2' }],
    ['steelseries arctis 7', { keywords: 'steelseries arctis 7' }],
    ['elgato stream deck', { keywords: 'elgato stream deck' }],
    ['go pro hero 12', { keywords: 'go pro hero 12' }],
    ['nintendo switch oled', { keywords: 'nintendo switch oled' }],
    ['ps5 pro', { keywords: 'ps5 pro' }],
    ['xbox series x', { keywords: 'xbox series x' }],
    ['raspberry pi 5', { keywords: 'raspberry pi 5' }],
    ['arduino uno', { keywords: 'arduino uno' }],
    ['3d printer', { keywords: '3d printer' }],
    ['webcam 1080p', { keywords: 'webcam 1080p' }],
    ['microphone blue yeti', { keywords: 'microphone blue yeti' }],
    ['usb c cable', { keywords: 'usb c cable' }],
  ])('preserves product: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - product queries with price filters', () => {
  it.each([
    ['rtx 3080 under 800', { max_price: 800 }],
    ['ryzen 7 over 200', { min_price: 200 }],
    ['34 inch ultrawide 300-500', { min_price: 300, max_price: 500 }],
    ['macbook pro m3 under 2000 on reddit', { max_price: 2000, source: 'reddit' }],
    ['thinkpad x1 carbon 800-1200 from craigslist', { min_price: 800, max_price: 1200, source: 'craigslist' }],
    ['ps5 pro max 600', { max_price: 600 }],
    ['xbox series x at least 300', { min_price: 300 }],
    ['nintendo switch oled under 300 on reddit', { max_price: 300, source: 'reddit' }],
    ['airpods pro 2 below 200 from craigslist', { max_price: 200, source: 'craigslist' }],
    ['samsung odyssey g7 400-700 on reddit', { min_price: 400, max_price: 700, source: 'reddit' }],
    ['logitech g pro wireless mouse under 100', { max_price: 100 }],
    ['corsair k70 keyboard over 50', { min_price: 50 }],
    ['steelseries arctis 7 100-150', { min_price: 100, max_price: 150 }],
    ['elgato stream deck budget 150', { max_price: 150 }],
    ['dell s2721dgf monitor 200-400 on reddit', { min_price: 200, max_price: 400, source: 'reddit' }],
    ['ipad pro m4 max 1500 from craigslist', { max_price: 1500, source: 'craigslist' }],
    ['go pro hero 12 under 400', { max_price: 400 }],
    ['raspberry pi 5 above 50', { min_price: 50 }],
    ['3d printer 200-500 on reddit', { min_price: 200, max_price: 500, source: 'reddit' }],
    ['webcam 1080p under 100 from craigslist', { max_price: 100, source: 'craigslist' }],
  ])('parses product + price: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - budget with various placements', () => {
  it.each([
    ['budget 200 keyboard', { max_price: 200 }],
    ['keyboard budget 200', { max_price: 200 }],
    ['budget keyboard 200', {}],  // 'keyboard' between 'budget' and '200' — cannot parse
    ['budget 150 gaming mouse', { max_price: 150 }],
    ['gaming mouse budget 150', { max_price: 150 }],
    ['budget 500 laptop from reddit', { max_price: 500, source: 'reddit' }],
    ['laptop budget 500 from reddit', { max_price: 500, source: 'reddit' }],
    ['budget 1000 on craigslist laptop', { max_price: 1000, source: 'craigslist' }],
    ['budget 50 headphones under 30', { max_price: 50 }],  // first match wins: 'budget 50'
    ['budget 100-200 keyboard', { min_price: 100, max_price: 200 }],
  ])('parses budget: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - reddit specific subreddit queries', () => {
  it.each([
    ['mechanical keyboards on mechmarket', {}],
    ['laptops on hardwareswap', {}],
    ['iphone on appleswap', {}],
  ])('ignores subreddit names: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - keywords with numbers', () => {
  it.each([
    ['usb 3.0 hub', {}],
    ['bluetooth 5.0', {}],
    ['wifi 6', {}],
    ['pcie 4.0', {}],
    ['ddr5 ram', {}],
    ['hdmi 2.1', {}],
    ['usb4', {}],
    ['type c', {}],
    ['nvidia 4090', {}],
    ['amd 7800x3d', {}],
  ])('preserves tech specs: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - deals with "or less" / "and under" suffixes', () => {
  it.each([
    ['keyboard 100 or less', { max_price: 100 }],
    ['gpu 200 and under', { max_price: 200 }],
    ['monitor 150 or less on reddit', { max_price: 150, source: 'reddit' }],
    ['phone 300 and under from craigslist', { max_price: 300, source: 'craigslist' }],
    ['laptop 500 or less budget', { max_price: 500 }],
  ])('parses "X or less/and under": "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - whitespace variations', () => {
  it.each([
    ['keyboard  under  100', { max_price: 100 }],
    ['  keyboard under 100  ', { max_price: 100 }],
    ['keyboard\tunder\t100', { max_price: 100 }],
    ['keyboard\nunder\n100', { max_price: 100 }],
    ['  ', {}],
    ['keyboard  100  -  200', { min_price: 100, max_price: 200 }],
  ])('handles whitespace: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - currency variations', () => {
  it.each([
    ['keyboard under €100', { max_price: 100 }],
    ['keyboard under £100', { max_price: 100 }],
    ['gpu over €500', { min_price: 500 }],
    ['monitor €100-€200', { min_price: 100, max_price: 200 }],
    ['laptop under CAD 1000', { max_price: 1000 }],
  ])('parses other currencies: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - edge cases with punctuation', () => {
  it.each([
    ['keyboard, under 100', { max_price: 100 }],
    ['gpu - over 500', { min_price: 500 }],
    ['monitor: 100-200', { min_price: 100, max_price: 200 }],
    ['phone (on reddit)', { source: 'reddit' }],
    ['laptop from craigslist!', { source: 'craigslist' }],
    ['camera? under 300', { max_price: 300 }],
    ['headphones: over 50 on reddit', { min_price: 50, source: 'reddit' }],
  ])('handles punctuation: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - no match returns empty keywords', () => {
  it.each([
    ['under', {}],
    ['over', {}],
    ['reddit', {}],
    ['craigslist', {}],
    ['cheap', {}],
    ['best', {}],
    ['deal', {}],
    ['on', {}],
    ['from', {}],
    ['to', {}],
  ])('handles single stop word: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - no source or price pollution in keywords', () => {
  it.each([
    ['keyboard under 200', { keywords: 'keyboard' }],
    ['keyboard under 200 or less', { keywords: 'keyboard' }],
    ['monitor 100 to 200', { keywords: 'monitor' }],
    ['laptop $500', { keywords: 'laptop' }],
    ['camera from reddit', { keywords: 'camera' }],
    ['gpu on craigslist above 300', { keywords: 'gpu' }],
    ['cheap phone under 100 on reddit', { keywords: 'phone' }],
    ['best gaming laptop 1000-1500 from craigslist', { keywords: 'gaming laptop' }],
    ['find me a deal on a monitor under 200', { keywords: 'monitor' }],
    ['show me cheap headphones on reddit over 50', { keywords: 'headphones' }],
  ])('clean keywords with price+source: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - exact keywords for simple queries', () => {
  it.each([
    ['keyboard', { keywords: 'keyboard' }],
    ['gaming laptop', { keywords: 'gaming laptop' }],
    ['mechanical keyboard red', { keywords: 'mechanical keyboard red' }],
    ['blue switches', { keywords: 'blue switches' }],
    ['used camera lens', { keywords: 'used camera lens' }],
    ['gaming desk 60 inch', { keywords: 'gaming desk 60 inch' }],
    ['monitor arm vesa', { keywords: 'monitor arm vesa' }],
    ['laptop bag 15 inch', { keywords: 'laptop bag 15 inch' }],
    ['desk lamp led', { keywords: 'desk lamp led' }],
    ['coffee grinder burr', { keywords: 'coffee grinder burr' }],
  ])('exact keywords: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - multiple max or min patterns only capture first', () => {
  it.each([
    ['under 100 under 200', { max_price: 100 }],
    ['over 500 over 1000', { min_price: 500 }],
    ['under 100 and over 500', { max_price: 100, min_price: 500 }],
    ['over 500 and under 100', { max_price: 100, min_price: 500 }],
    ['above 100 below 200 below 50', { min_price: 100, max_price: 200 }],
  ])('handles multiple prices: "%s"', (query, expected) => {
    check(query, expected);
  });
});

describe('basicParse - queries with no price/source just return keywords', () => {
  it.each([
    ['wanted: mechanical keyboard', {}],
    ['for sale: gaming laptop', {}],
    ['WTB monitor 27 inch', {}],
    ['selling gpu 3080', {}],
    ['trade: camera lens', {}],
  ])('handles listing prefixes: "%s"', (query, expected) => {
    check(query, expected);
  });
});
