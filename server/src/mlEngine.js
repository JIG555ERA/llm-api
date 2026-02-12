const MODEL_ID = "database-grounded-generator-v2";
const DEFAULT_BOOKS_API_URL = "https://admin.ylw.co.in/api/v1/books/all";
const DEFAULT_AUTHORS_API_URL = "https://admin.ylw.co.in/api/v1/authors/all";
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
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "your",
    "you",
    "are",
    "was",
    "were",
    "will",
    "would",
    "there",
    "their",
    "about",
    "into",
    "around",
    "then",
    "than",
    "them",
    "they",
    "she",
    "her",
    "him",
    "his",
    "our",
    "ours",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "whom",
    "why",
    "how",
    "not",
    "but",
    "can",
    "could",
    "should",
    "just",
    "very",
    "also",
    "only",
    "each",
    "every",
    "any",
    "all",
    "one",
    "two",
    "three",
    "out",
    "off",
    "over",
    "under",
    "after",
    "before",
    "through",
    "across",
    "like",
    "such",
    "because",
    "been",
    "being",
    "make",
    "made",
    "does",
    "did",
    "doing",
    "if",
    "try",
    "stop",
    "look",
    "looking",
    "understand",
  ]);

  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopwords.has(word));
}

function truncateWords(text, maxWords) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function sharedTokenCount(a, b) {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) {
      count += 1;
    }
  }
  return count;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractCharacterCandidates(text) {
  const source = String(text || "");
  const blacklist = new Set([
    "The",
    "When",
    "From",
    "But",
    "And",
    "For",
    "With",
    "Book",
    "Even",
    "Rich",
    "Dad",
    "Poor",
    "English",
    "Indian",
  ]);

  const matches = source.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
  return unique(
    matches
      .map((name) => name.trim())
      .filter((name) => {
        if (name.length <= 2 || blacklist.has(name)) {
          return false;
        }
        if (/^\b(The|A|An)\b/.test(name)) {
          return false;
        }
        if (/(Rich Dad|Poor Dad|Book)/i.test(name)) {
          return false;
        }
        return true;
      })
  ).slice(0, 5);
}

const THEME_KEYWORDS = {
  romance: [
    "love",
    "girlfriend",
    "boyfriend",
    "romance",
    "relationship",
    "falling",
    "heart",
    "couple",
    "feelings",
    "together",
    "quiet",
    "presence",
    "chaos",
    "constant",
  ],
  mythology: [
    "mythology",
    "immortality",
    "epics",
    "hindu",
    "nagendra",
    "shastri",
    "mritsanjeevani",
    "battle",
    "ancient",
  ],
  finance: [
    "money",
    "rich",
    "dad",
    "financial",
    "freedom",
    "invest",
    "wealth",
    "kids",
  ],
  thriller: ["mystery", "thrilling", "secrets", "hidden", "truth", "journey", "time"],
};

function detectThemes(text) {
  const tokens = new Set(tokenize(text));
  const scoreByTheme = {};
  for (const [theme, words] of Object.entries(THEME_KEYWORDS)) {
    let score = 0;
    for (const word of words) {
      if (tokens.has(word)) {
        score += 1;
      }
    }
    scoreByTheme[theme] = score;
  }
  return scoreByTheme;
}

function themeSimilarity(promptThemeScore, bookThemeScore) {
  let score = 0;
  for (const theme of Object.keys(THEME_KEYWORDS)) {
    score += Math.min(promptThemeScore[theme] || 0, bookThemeScore[theme] || 0);
  }
  return score;
}

class LLMEngine {
  constructor() {
    this.modelId = MODEL_ID;
    this.booksApiUrl = process.env.BOOKS_API_URL || DEFAULT_BOOKS_API_URL;
    this.authorsApiUrl = process.env.AUTHORS_API_URL || DEFAULT_AUTHORS_API_URL;
    this.wikipediaApi = process.env.WIKIPEDIA_API_BASE || DEFAULT_WIKIPEDIA_API;
    this.cache = {
      books: [],
      authors: [],
      updatedAt: 0,
    };
  }

  async loadModel() {
    console.log(`Engine configured: ${this.modelId}`);
    console.log(`Books source: ${this.booksApiUrl}`);
    console.log(`Authors source: ${this.authorsApiUrl}`);
  }

  async fetchJSON(url) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Upstream API request failed with status ${response.status}.`);
    }

    return response.json();
  }

  async fetchCatalog() {
    const now = Date.now();
    const maxCacheAgeMs = 60 * 1000;
    if (
      this.cache.books.length &&
      this.cache.authors.length &&
      now - this.cache.updatedAt < maxCacheAgeMs
    ) {
      return {
        books: this.cache.books,
        authors: this.cache.authors,
      };
    }

    const [booksPayload, authorsPayload] = await Promise.all([
      this.fetchJSON(this.booksApiUrl),
      this.fetchJSON(this.authorsApiUrl),
    ]);

    const books = Array.isArray(booksPayload?.data) ? booksPayload.data : [];
    const authors = Array.isArray(authorsPayload)
      ? authorsPayload
      : Array.isArray(authorsPayload?.data)
        ? authorsPayload.data
        : [];

    this.cache = {
      books,
      authors,
      updatedAt: now,
    };

    return { books, authors };
  }

  normalizeBook(book) {
    const price = Array.isArray(book?.price) && book.price[0] ? book.price[0] : null;
    const description = stripLinks(book?.description);
    return {
      id: book?.id ?? null,
      title: stripLinks(book?.title),
      description,
      language: stripLinks(book?.language),
      authors: Array.isArray(book?.authors)
        ? book.authors.map((author) => stripLinks(author?.name)).filter(Boolean)
        : [],
      categories: Array.isArray(book?.categories)
        ? book.categories.map((category) => stripLinks(category?.name)).filter(Boolean)
        : [],
      characters: extractCharacterCandidates(description),
      price: {
        selling: price?.selling ?? null,
        purchase: price?.purchase ?? null,
      },
    };
  }

  normalizeAuthor(author) {
    return {
      id: author?.id ?? null,
      name: stripLinks(author?.name),
      pen_name: stripLinks(author?.pen_name),
      bio: stripLinks(author?.bio),
      profile_pic: author?.profile_pic || null,
      book_count: author?.book_count ?? 0,
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
    const bookThemeScore = detectThemes(`${title} ${description} ${categories.join(" ")}`);
    const promptThemeScore = detectThemes(promptLower);

    let score = 0;

    if (title && promptLower.includes(title)) {
      score += 100;
    }

    for (const authorName of authors) {
      if (authorName && promptLower.includes(authorName)) {
        score += 60;
      }
    }

    for (const categoryName of categories) {
      if (categoryName && promptLower.includes(categoryName)) {
        score += 30;
      }
    }

    const titleTokens = new Set(tokenize(title));
    const descTokens = new Set(tokenize(description));
    const overlapInTitle = sharedTokenCount(promptTokensSet, titleTokens);
    const overlapInDesc = sharedTokenCount(promptTokensSet, descTokens);
    score += overlapInTitle * 18;
    score += overlapInDesc * 7;

    const themeScore = themeSimilarity(promptThemeScore, bookThemeScore);
    score += themeScore * 22;

    const promptIsRomanceHeavy =
      (promptThemeScore.romance || 0) >= 2 &&
      (promptThemeScore.mythology || 0) === 0 &&
      (promptThemeScore.finance || 0) === 0;
    const bookIsRomanceHeavy =
      (bookThemeScore.romance || 0) >= 1 ||
      /\bgirlfriend|boyfriend|love|falling for each other|relationship\b/i.test(
        `${title} ${description}`
      );
    const bookIsMythologyHeavy = (bookThemeScore.mythology || 0) >= 2;
    const bookIsFinanceHeavy = (bookThemeScore.finance || 0) >= 2;

    if (promptIsRomanceHeavy && bookIsRomanceHeavy) {
      score += 70;
    }
    if (promptIsRomanceHeavy && (bookIsMythologyHeavy || bookIsFinanceHeavy)) {
      score -= 35;
    }

    return score;
  }

  scoreAuthor(author, promptLower, promptTokensSet, matchedBooks) {
    const name = String(author?.name || "").toLowerCase();
    const penName = String(author?.pen_name || "").toLowerCase();
    const bio = String(author?.bio || "").toLowerCase();
    const authorTokens = new Set(tokenize(`${name} ${penName} ${bio}`));

    let score = 0;

    if (name && promptLower.includes(name)) {
      score += 100;
    }
    if (penName && promptLower.includes(penName)) {
      score += 70;
    }

    score += sharedTokenCount(promptTokensSet, authorTokens) * 8;

    const matchedBookAuthors = new Set(
      matchedBooks.flatMap((book) => (Array.isArray(book?.authors) ? book.authors : []))
    );
    if (matchedBookAuthors.has(author?.name)) {
      score += 40;
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

  matchAuthors(prompt, authors, matchedBooks, limit = 5) {
    const promptLower = String(prompt || "").toLowerCase();
    const promptTokensSet = new Set(tokenize(prompt));

    const scored = authors
      .map((author) => ({
        score: this.scoreAuthor(author, promptLower, promptTokensSet, matchedBooks),
        author,
      }))
      .sort((a, b) => b.score - a.score);

    const strongMatches = scored.filter((item) => item.score > 0).slice(0, limit);
    return strongMatches.map((item) => this.normalizeAuthor(item.author));
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

  buildCharacterAnswer(matchedBooks) {
    const characterPool = unique(matchedBooks.flatMap((book) => book.characters || [])).slice(0, 8);
    if (!characterPool.length) {
      return "I could not find clearly named characters in the available catalog descriptions yet.";
    }
    return `Based on your catalog descriptions, likely character names include ${characterPool.join(", ")}.`;
  }

  buildAuthorAnswer(matchedAuthors, matchedBooks) {
    if (!matchedAuthors.length) {
      const firstBook = matchedBooks[0];
      if (!firstBook) {
        return "I could not confirm the author from the current catalog data.";
      }
      const authorText = firstBook.authors.length
        ? firstBook.authors.join(", ")
        : "author details are not listed";
      return `For "${firstBook.title}", the listed author is ${authorText}.`;
    }

    const primary = matchedAuthors[0];
    const bio = primary.bio ? truncateWords(primary.bio, 30) : "bio is not available in the author API";
    return `${primary.name} is a matching author in your database. Bio summary: ${bio}.`;
  }

  buildPriceAnswer(matchedBooks) {
    const priced = matchedBooks.filter((book) => book?.price?.selling);
    if (!priced.length) {
      return "I found matching books, but selling prices are currently not listed for them.";
    }
    const lines = priced
      .slice(0, 3)
      .map((book) => `${book.title}: Rs. ${book.price.selling}`)
      .join("; ");
    return `Here are the latest listed prices from your catalog: ${lines}.`;
  }

  buildGeneralBookAnswer(prompt, matchedBooks, matchedAuthors, wikiContext) {
    const cleanPrompt = stripLinks(prompt);
    const topBook = matchedBooks[0];

    const openLine = topBook
      ? `I understood your request about "${cleanPrompt}". The strongest match is "${topBook.title}".`
      : `I understood your request about "${cleanPrompt}" and checked your catalog.`;

    const bookLines = matchedBooks.slice(0, 3).map((book, idx) => {
      const authorText = book.authors.length ? book.authors.join(", ") : "Unknown author";
      const description = truncateWords(book.description || "", 26);
      return `${idx + 1}. ${book.title} by ${authorText} - ${description}`;
    });

    const authorLine = matchedAuthors.length
      ? `Matching author: ${matchedAuthors[0].name}.`
      : "No explicit author keyword was detected in your query.";

    const contextLine = wikiContext
      ? `Additional context: ${wikiContext.title} - ${wikiContext.extract}`
      : "Additional context: response is based on your internal catalog data.";

    return `${openLine}\n\n${bookLines.join("\n")}\n\n${authorLine}\n${contextLine}`;
  }

  buildGenerativeText(prompt, matchedBooks, matchedAuthors, wikiContext, maxNewTokens) {
    const promptLower = String(prompt || "").toLowerCase();
    const asksAuthor = /(author|wrote|written by|writer|pen name)/i.test(promptLower);
    const asksCharacters = /(character|characters|who is|who are|protagonist|villain)/i.test(
      promptLower
    );
    const asksPrice = /(price|cost|budget|cheap|expensive|purchase|buy)/i.test(promptLower);

    let response = "";
    if (asksCharacters) {
      response = `${this.buildCharacterAnswer(matchedBooks)} ${this.buildGeneralBookAnswer(
        prompt,
        matchedBooks,
        matchedAuthors,
        wikiContext
      )}`;
    } else if (asksAuthor) {
      response = `${this.buildAuthorAnswer(matchedAuthors, matchedBooks)} ${this.buildGeneralBookAnswer(
        prompt,
        matchedBooks,
        matchedAuthors,
        wikiContext
      )}`;
    } else if (asksPrice) {
      response = `${this.buildPriceAnswer(matchedBooks)} ${this.buildGeneralBookAnswer(
        prompt,
        matchedBooks,
        matchedAuthors,
        wikiContext
      )}`;
    } else {
      response = this.buildGeneralBookAnswer(prompt, matchedBooks, matchedAuthors, wikiContext);
    }

    response = `${response}\n\nIf you want, I can refine this answer by language, genre, author, or budget.`;
    return truncateWords(stripLinks(response), Math.max(60, maxNewTokens));
  }

  async generate(prompt, maxNewTokens = 256) {
    const { books, authors } = await this.fetchCatalog();
    if (!books.length) {
      throw new Error("No books found in the database API response.");
    }

    const matchedBooks = this.matchBooks(prompt, books);
    const matchedAuthors = this.matchAuthors(prompt, authors, matchedBooks);

    const wikiQuery = matchedBooks[0]?.title || matchedAuthors[0]?.name || prompt;
    const wikiContext = await this.fetchWikipediaExtract(wikiQuery);

    const result = this.buildGenerativeText(
      prompt,
      matchedBooks,
      matchedAuthors,
      wikiContext,
      maxNewTokens
    );

    return {
      result,
      matched_books: matchedBooks,
      matched_authors: matchedAuthors,
    };
  }
}

const llmEngine = new LLMEngine();

module.exports = {
  llmEngine,
  MODEL_ID,
};
