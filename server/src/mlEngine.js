const MODEL_ID = "database-grounded-generator-v1";
const DEFAULT_BOOKS_API_URL = "https://admin.ylw.co.in/api/v1/books/all";
const DEFAULT_WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

function stripLinks(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWikiCitations(text) {
  return stripLinks(text).replace(/\[\d+\]/g, "").trim();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function truncateWords(text, maxWords) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

class LLMEngine {
  constructor() {
    this.modelId = MODEL_ID;
    this.booksApiUrl = process.env.BOOKS_API_URL || DEFAULT_BOOKS_API_URL;
    this.wikipediaApi = process.env.WIKIPEDIA_API_BASE || DEFAULT_WIKIPEDIA_API;
    this.cache = {
      books: [],
      updatedAt: 0,
    };
  }

  async loadModel() {
    console.log(`Engine configured: ${this.modelId}`);
    console.log(`Books source: ${this.booksApiUrl}`);
  }

  async fetchBooks() {
    const now = Date.now();
    const maxCacheAgeMs = 60 * 1000;
    if (this.cache.books.length && now - this.cache.updatedAt < maxCacheAgeMs) {
      return this.cache.books;
    }

    const response = await fetch(this.booksApiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Books API request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    const books = Array.isArray(payload?.data) ? payload.data : [];
    this.cache = {
      books,
      updatedAt: now,
    };
    return books;
  }

  normalizeBook(book) {
    const price = Array.isArray(book?.price) && book.price[0] ? book.price[0] : null;
    return {
      id: book?.id ?? null,
      title: stripLinks(book?.title),
      description: stripLinks(book?.description),
      language: stripLinks(book?.language),
      authors: Array.isArray(book?.authors)
        ? book.authors.map((author) => stripLinks(author?.name)).filter(Boolean)
        : [],
      categories: Array.isArray(book?.categories)
        ? book.categories.map((category) => stripLinks(category?.name)).filter(Boolean)
        : [],
      price: {
        selling: price?.selling ?? null,
        purchase: price?.purchase ?? null,
      },
    };
  }

  scoreBook(book, promptLower, promptTokensSet) {
    const title = String(book?.title || "").toLowerCase();
    const description = String(book?.description || "").toLowerCase();
    const authors = Array.isArray(book?.authors)
      ? book.authors.map((author) => String(author?.name || "").toLowerCase())
      : [];
    const categories = Array.isArray(book?.categories)
      ? book.categories.map((category) => String(category?.name || "").toLowerCase())
      : [];

    let score = 0;

    if (title && promptLower.includes(title)) {
      score += 80;
    }

    for (const authorName of authors) {
      if (authorName && promptLower.includes(authorName)) {
        score += 45;
      }
    }

    for (const categoryName of categories) {
      if (categoryName && promptLower.includes(categoryName)) {
        score += 25;
      }
    }

    const searchable = `${title} ${description} ${authors.join(" ")} ${categories.join(" ")}`;
    const searchableTokens = new Set(tokenize(searchable));
    for (const token of promptTokensSet) {
      if (searchableTokens.has(token)) {
        score += 3;
      }
    }

    return score;
  }

  matchBooks(prompt, books, limit = 5) {
    const promptLower = String(prompt || "").toLowerCase();
    const promptTokensSet = new Set(tokenize(prompt));

    const scored = books
      .map((book) => ({
        score: this.scoreBook(book, promptLower, promptTokensSet),
        book,
      }))
      .sort((a, b) => b.score - a.score);

    const strongMatches = scored.filter((item) => item.score > 0).slice(0, limit);
    if (strongMatches.length) {
      return strongMatches.map((item) => this.normalizeBook(item.book));
    }

    return scored.slice(0, Math.min(3, scored.length)).map((item) => this.normalizeBook(item.book));
  }

  async fetchWikipediaExtract(query) {
    if (!query) {
      return null;
    }

    const searchParams = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "1",
      format: "json",
      utf8: "1",
      origin: "*",
    });

    const searchResponse = await fetch(`${this.wikipediaApi}?${searchParams.toString()}`);
    if (!searchResponse.ok) {
      return null;
    }

    const searchPayload = await searchResponse.json();
    const title = searchPayload?.query?.search?.[0]?.title;
    if (!title) {
      return null;
    }

    const extractParams = new URLSearchParams({
      action: "query",
      prop: "extracts",
      explaintext: "1",
      exintro: "1",
      titles: title,
      format: "json",
      origin: "*",
    });

    const extractResponse = await fetch(`${this.wikipediaApi}?${extractParams.toString()}`);
    if (!extractResponse.ok) {
      return null;
    }

    const extractPayload = await extractResponse.json();
    const pages = extractPayload?.query?.pages || {};
    const firstPage = Object.values(pages)[0];
    const extract = stripWikiCitations(firstPage?.extract || "");

    if (!extract) {
      return null;
    }

    return {
      title: stripLinks(title),
      extract: truncateWords(extract, 70),
    };
  }

  buildGenerativeText(prompt, matchedBooks, wikiContext, maxNewTokens, temperature) {
    const cleanPrompt = stripLinks(prompt);
    const friendlyOpeners = [
      `Great choice. I found strong matches for "${cleanPrompt}".`,
      `Nice pick. Here are the best matches I found for "${cleanPrompt}".`,
      `Got it. Based on your query "${cleanPrompt}", these are the most relevant books.`,
    ];
    const openerIndex = Math.min(
      friendlyOpeners.length - 1,
      Math.floor(Math.max(0, Math.min(0.99, temperature)) * friendlyOpeners.length)
    );

    const bookLines = matchedBooks.map((book, idx) => {
      const authorText = book.authors.length ? book.authors.join(", ") : "Unknown author";
      const categoryText = book.categories.length ? book.categories.join(", ") : "General";
      const description = truncateWords(book.description || "", 28);
      const sellingPrice = book?.price?.selling ? `Rs. ${book.price.selling}` : "price not listed";
      return `${idx + 1}. ${book.title} by ${authorText} (${categoryText}) - ${description} Current price: ${sellingPrice}.`;
    });

    const wikiLine = wikiContext
      ? `Quick context: ${wikiContext.title} - ${wikiContext.extract}`
      : "Quick context: I focused only on your catalog data for this response.";

    const topPick = matchedBooks[0];
    const topPickLine = topPick
      ? `If you want one recommendation to start with, go with "${topPick.title}".`
      : "I can refine this further if you share your preferred genre, budget, or language.";

    const closingLine =
      "If you want, I can also suggest the best order to read these and a budget-friendly pick.";

    const finalText = `${friendlyOpeners[openerIndex]}\n\n${bookLines.join(
      "\n"
    )}\n\n${wikiLine}\n\n${topPickLine} ${closingLine}`;
    return truncateWords(finalText, Math.max(40, maxNewTokens));
  }

  async generate(prompt, maxNewTokens = 256, temperature = 0.7) {
    const books = await this.fetchBooks();
    if (!books.length) {
      throw new Error("No books found in the database API response.");
    }

    const matchedBooks = this.matchBooks(prompt, books);
    const wikiQuery = matchedBooks[0]?.title || prompt;
    const wikiContext = await this.fetchWikipediaExtract(wikiQuery);

    const result = this.buildGenerativeText(
      prompt,
      matchedBooks,
      wikiContext,
      maxNewTokens,
      temperature
    );

    return {
      result: stripLinks(result),
      matched_books: matchedBooks,
    };
  }
}

const llmEngine = new LLMEngine();

module.exports = {
  llmEngine,
  MODEL_ID,
};
