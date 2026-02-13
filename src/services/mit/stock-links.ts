export interface StockLinks {
  ticker: string;
  screener: string;
  moneycontrol: string;
  trendlyne: string;
  nse: string;
  bse: string;
  googleFinance: string;
  yahooFinance: string;
  tradingView: string;
}

export interface NewsLink {
  source: string;
  searchUrl: string;
  rssUrl?: string;
}

export class StockLinksService {
  getLinks(ticker: string): StockLinks {
    const normalizedTicker = normalizeTicker(ticker);
    const encodedTicker = encodeURIComponent(normalizedTicker);

    return {
      ticker: normalizedTicker,
      screener: `https://www.screener.in/company/${encodedTicker}/consolidated/`,
      moneycontrol: `https://www.moneycontrol.com/india/stockpricequote/search?search_str=${encodedTicker}`,
      trendlyne: `https://trendlyne.com/equity/${encodedTicker}/`,
      nse: `https://www.nseindia.com/get-quotes/equity?symbol=${encodedTicker}`,
      bse: `https://www.bseindia.com/stock-share-price/${encodedTicker}/`,
      googleFinance: `https://www.google.com/finance/quote/${encodedTicker}:NSE`,
      yahooFinance: `https://finance.yahoo.com/quote/${encodedTicker}.NS`,
      tradingView: `https://www.tradingview.com/symbols/NSE-${encodedTicker}/`,
    };
  }

  getNewsLinks(ticker: string): NewsLink[] {
    const normalizedTicker = normalizeTicker(ticker);
    const encodedQuery = encodeURIComponent(`${normalizedTicker} stock India`);
    const encodedTicker = encodeURIComponent(normalizedTicker);

    return [
      {
        source: "Google News",
        searchUrl: `https://news.google.com/search?q=${encodedQuery}`,
        rssUrl: `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`,
      },
      {
        source: "MoneyControl",
        searchUrl: `https://www.moneycontrol.com/news/tags/${encodedTicker}.html`,
      },
    ];
  }
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}
