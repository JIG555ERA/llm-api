const MODEL_ID = "database-grounded-generator-v2";
const DEFAULT_BOOKS_API_URL = "https://admin.ylw.co.in/api/v1/books/all";
const DEFAULT_AUTHORS_API_URL = "https://admin.ylw.co.in/api/v1/authors/all";
const DEFAULT_GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes";
const DEFAULT_OPEN_LIBRARY_API = "https://openlibrary.org/search.json";
const DEFAULT_WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const DEFAULT_LLAMA_MODEL = "meta-llama/Llama-3.1-8B-Instruct";

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

function splitIntoSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
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

function detectIntent(promptText) {
  const lower = String(promptText || "").toLowerCase();
  return {
    asksAuthor: /(author|wrote|written by|writer|pen name)/i.test(lower),
    asksCharacters: /(character|characters|who is|who are|protagonist|villain)/i.test(lower),
    asksPrice: /(price|cost|budget|cheap|expensive|purchase|buy)/i.test(lower),
    asksFinance: /(finance|financial|money|wealth|invest|investment)/i.test(lower),
    asksRomance: /(romance|love|girlfriend|boyfriend|relationship|couple)/i.test(lower),
    asksMythology: /(mythology|hindu|immortality|nagendra|shastri|ancient epic)/i.test(lower),
    asksPublisher: /(publisher|publication|published by|publishing house)/i.test(lower),
  };
}

function getBookAuthorNames(book) {
  if (!Array.isArray(book?.authors)) {
    return [];
  }
  return book.authors
    .map((author) => {
      if (typeof author === "string") {
        return author.trim();
      }
      return String(author?.name || "").trim();
    })
    .filter(Boolean);
}

function getBookDescription(book) {
  return String(book?.description || "");
}

function getBookPrimarySellingPrice(book) {
  if (Array.isArray(book?.price) && book.price[0]?.selling) {
    return book.price[0].selling;
  }
  if (book?.price && typeof book.price === "object" && book.price.selling) {
    return book.price.selling;
  }
  return null;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getBookCategoryNames(book) {
  if (!Array.isArray(book?.categories)) {
    return [];
  }
  return book.categories
    .map((category) => String(category?.name || "").trim())
    .filter(Boolean);
}

function buildQueryChunks(prompt) {
  const words = tokenize(prompt);
  const chunks = [];

  for (let i = 0; i < words.length; i += 1) {
    chunks.push(words[i]);
    if (i + 1 < words.length) {
      chunks.push(`${words[i]} ${words[i + 1]}`);
    }
    if (i + 2 < words.length) {
      chunks.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }

  return unique(chunks.filter((chunk) => chunk.length >= 3));
}

function getBookTitle(book) {
  return String(book?.title || "").trim();
}

function pickRandom(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  return items[Math.floor(Math.random() * items.length)];
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

class LLMEngine {
  constructor() {
    this.modelId = MODEL_ID;
    this.booksApiUrl = process.env.BOOKS_API_URL || DEFAULT_BOOKS_API_URL;
    this.authorsApiUrl = process.env.AUTHORS_API_URL || DEFAULT_AUTHORS_API_URL;
    this.googleBooksApi = process.env.GOOGLE_BOOKS_API_BASE || DEFAULT_GOOGLE_BOOKS_API;
    this.googleBooksApiKey = process.env.GOOGLE_BOOKS_API_KEY || "";
    this.openLibraryApi = process.env.OPEN_LIBRARY_API_BASE || DEFAULT_OPEN_LIBRARY_API;
    this.wikipediaApi = process.env.WIKIPEDIA_API_BASE || DEFAULT_WIKIPEDIA_API;
    this.llamaModel = process.env.LLAMA_MODEL_ID || DEFAULT_LLAMA_MODEL;
    this.hfToken = process.env.HF_API_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || "";
    this.cache = {
      books: [],
      authors: [],
      updatedAt: 0,
    };
    this.semantic = {
      enabled: true,
      extractor: null,
      modelId: process.env.TRANSFORMERS_MODEL_ID || "Xenova/all-MiniLM-L6-v2",
      loadingPromise: null,
      intentVectors: null,
    };
  }

  async loadModel() {
    console.log(`Engine configured: ${this.modelId}`);
    console.log(`Books source: ${this.booksApiUrl}`);
    console.log(`Authors source: ${this.authorsApiUrl}`);
    console.log(`Google Books source: ${this.googleBooksApi}`);
    console.log(`OpenLibrary source: ${this.openLibraryApi}`);
    console.log(`Transformers NLP: ${this.semantic.enabled ? "enabled" : "disabled"}`);
    console.log(`Generative model: ${this.llamaModel}`);
  }

  async getSemanticExtractor() {
    if (!this.semantic.enabled) {
      return null;
    }
    if (this.semantic.extractor) {
      return this.semantic.extractor;
    }
    if (this.semantic.loadingPromise) {
      return this.semantic.loadingPromise;
    }

    this.semantic.loadingPromise = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      const extractor = await pipeline("feature-extraction", this.semantic.modelId);
      this.semantic.extractor = extractor;
      return extractor;
    })();

    try {
      return await this.semantic.loadingPromise;
    } catch (error) {
      this.semantic.enabled = false;
      return null;
    } finally {
      this.semantic.loadingPromise = null;
    }
  }

  async embedText(text) {
    const extractor = await this.getSemanticExtractor();
    if (!extractor) {
      return null;
    }
    const output = await extractor(String(text || ""), {
      pooling: "mean",
      normalize: true,
    });
    if (!output?.data) {
      return null;
    }
    return Array.from(output.data);
  }

  async semanticRerank(prompt, candidates) {
    if (!this.semantic.enabled || !candidates.length) {
      return candidates;
    }

    const promptVector = await this.embedText(prompt);
    if (!promptVector) {
      return candidates;
    }

    const reranked = [];
    for (const item of candidates) {
      const semanticText = `${item?.book?.title || ""} ${item?.book?.description || ""} ${getBookAuthorNames(item?.book).join(" ")} ${getBookCategoryNames(item?.book).join(" ")}`;
      const bookVector = await this.embedText(semanticText);
      const semanticScore = bookVector ? cosineSimilarity(promptVector, bookVector) : 0;
      reranked.push({
        ...item,
        score: item.score + semanticScore * 180,
      });
    }

    return reranked.sort((a, b) => b.score - a.score);
  }

  async getIntentVectors() {
    if (this.semantic.intentVectors) {
      return this.semantic.intentVectors;
    }

    const labels = {
      greeting: "hello hi good morning good evening hey there",
      author: "who wrote this book author writer pen name",
      price: "price under budget cheap costly expensive buy",
      character: "main character protagonist villain cast in story",
      publisher: "publisher publication publishing house imprint",
      recommendation: "suggest top best books recommend reading list",
      general: "complex question detailed explanation analysis",
    };

    const entries = Object.entries(labels);
    const vectors = {};
    for (const [key, text] of entries) {
      vectors[key] = await this.embedText(text);
    }
    this.semantic.intentVectors = vectors;
    return vectors;
  }

  async decideWithTransformers(prompt) {
    const promptVector = await this.embedText(prompt);
    if (!promptVector) {
      const fallbackIntent = detectIntent(prompt);
      if (fallbackIntent.asksAuthor) return { mode: "author", confidence: 0.5 };
      if (fallbackIntent.asksPrice) return { mode: "price", confidence: 0.5 };
      if (fallbackIntent.asksCharacters) return { mode: "character", confidence: 0.5 };
      if (fallbackIntent.asksPublisher) return { mode: "publisher", confidence: 0.5 };
      return { mode: "general", confidence: 0.4 };
    }

    const vectors = await this.getIntentVectors();
    const scores = Object.entries(vectors).map(([mode, vec]) => ({
      mode,
      score: vec ? cosineSimilarity(promptVector, vec) : -1,
    }));
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0] || { mode: "general", score: 0 };

    return {
      mode: best.mode,
      confidence: best.score,
      scores,
    };
  }

  buildGoogleBooksUrl(query) {
    const params = new URLSearchParams({
      q: query,
      maxResults: "10",
      printType: "books",
      projection: "lite",
      langRestrict: "en",
    });
    if (this.googleBooksApiKey) {
      params.set("key", this.googleBooksApiKey);
    }
    return `${this.googleBooksApi}?${params.toString()}`;
  }

  buildGoogleBooksSummaryUrl(query, language = "en", maxResults = 8) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.max(1, Math.min(20, maxResults))),
      printType: "books",
      projection: "full",
      langRestrict: language || "en",
    });
    if (this.googleBooksApiKey) {
      params.set("key", this.googleBooksApiKey);
    }
    return `${this.googleBooksApi}?${params.toString()}`;
  }

  normalizeGoogleBook(item) {
    const info = item?.volumeInfo || {};
    const sale = item?.saleInfo || {};
    const title = stripLinks(info?.title || "");
    const subtitle = stripLinks(info?.subtitle || "");
    const description = stripLinks(info?.description || "");
    const authors = Array.isArray(info?.authors) ? info.authors.map((a) => stripLinks(a)).filter(Boolean) : [];
    const categories = Array.isArray(info?.categories)
      ? info.categories.map((c) => stripLinks(c)).filter(Boolean)
      : [];

    return {
      id: item?.id || null,
      title,
      subtitle,
      description,
      authors,
      publisher: stripLinks(info?.publisher || ""),
      categories,
      published_date: info?.publishedDate || null,
      page_count: Number.isFinite(info?.pageCount) ? info.pageCount : null,
      average_rating: Number.isFinite(info?.averageRating) ? info.averageRating : null,
      ratings_count: Number.isFinite(info?.ratingsCount) ? info.ratingsCount : null,
      maturity_rating: info?.maturityRating || null,
      language: info?.language || null,
      image: info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail || null,
      industry_identifiers: Array.isArray(info?.industryIdentifiers) ? info.industryIdentifiers : [],
      saleability: sale?.saleability || null,
    };
  }

  async fetchGoogleSummaryCandidates(query, language = "en", maxResults = 8) {
    const url = this.buildGoogleBooksSummaryUrl(query, language, maxResults);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item) => this.normalizeGoogleBook(item)).filter((item) => item.title);
  }

  scoreSummaryCandidate(candidate, query, author = "") {
    const qTokens = new Set(tokenize(query));
    const titleTokens = new Set(tokenize(candidate?.title || ""));
    const descTokens = new Set(tokenize(candidate?.description || ""));
    const authorBlob = (candidate?.authors || []).join(" ");
    const authorTokens = new Set(tokenize(authorBlob));
    const catTokens = new Set(tokenize((candidate?.categories || []).join(" ")));

    let score = 0;
    score += sharedTokenCount(qTokens, titleTokens) * 28;
    score += sharedTokenCount(qTokens, descTokens) * 8;
    score += sharedTokenCount(qTokens, catTokens) * 10;

    const qLower = String(query || "").toLowerCase();
    const titleLower = String(candidate?.title || "").toLowerCase();
    if (titleLower && qLower.includes(titleLower)) {
      score += 120;
    }

    const requestedAuthor = normalizeText(author || "");
    if (requestedAuthor) {
      const candidateAuthors = (candidate?.authors || []).map((name) => normalizeText(name));
      if (candidateAuthors.includes(requestedAuthor)) {
        score += 140;
      } else if (candidateAuthors.some((name) => name.includes(requestedAuthor) || requestedAuthor.includes(name))) {
        score += 80;
      } else {
        score -= 40;
      }
    } else {
      score += sharedTokenCount(qTokens, authorTokens) * 14;
    }

    if (candidate?.average_rating) {
      score += candidate.average_rating * 4;
    }
    if (candidate?.ratings_count) {
      score += Math.min(20, Math.log10(candidate.ratings_count + 1) * 6);
    }

    return score;
  }

  buildKeyTakeaways(primaryBook, wikiContext, maxTakeaways = 5) {
    const pool = [
      ...splitIntoSentences(primaryBook?.description || ""),
      ...splitIntoSentences(wikiContext?.extract || ""),
    ].filter((line) => line.length > 40);

    const uniqueLines = unique(pool.map((line) => truncateWords(line, 24)));
    const compact = uniqueLines.slice(0, Math.max(3, Math.min(8, maxTakeaways)));
    if (compact.length) {
      return compact;
    }

    return [
      `This book explores layered ideas through a distinct narrative voice.`,
      `Its strongest value comes from how it connects theme with practical reader impact.`,
      `The reading experience is best for audiences looking for depth rather than surface-level plot beats.`,
    ];
  }

  buildInspiredQuoteLines(primaryBook, wikiContext, maxQuotes = 3) {
    const title = primaryBook?.title || "this book";
    const theme = (primaryBook?.categories || []).slice(0, 2).join(", ") || "its central themes";
    const base = [
      `In "${title}", meaning often appears quietly before it becomes obvious.`,
      `The narrative rhythm turns ${theme} into something emotionally immediate.`,
      `Its core idea lingers: growth is usually subtle before it is visible.`,
      `The story suggests that perspective can change outcomes more than circumstance.`,
    ];
    if (wikiContext?.extract) {
      base.push(`A wider context reinforces why "${title}" resonates beyond a single genre lane.`);
    }
    return unique(base).slice(0, Math.max(1, Math.min(5, maxQuotes)));
  }

  async buildSimilarBooksForSummary(primaryBook, catalogBooks, topK = 4) {
    if (!primaryBook || !Array.isArray(catalogBooks) || !catalogBooks.length) {
      return [];
    }

    const targetText = normalizeText(
      `${primaryBook.title || ""} ${primaryBook.description || ""} ${(primaryBook.authors || []).join(" ")} ${(primaryBook.categories || []).join(" ")}`
    );
    const targetTokens = new Set(tokenize(targetText));

    const scored = catalogBooks
      .map((book) => {
        const text = normalizeText(
          `${getBookTitle(book)} ${getBookDescription(book)} ${getBookAuthorNames(book).join(" ")} ${getBookCategoryNames(book).join(" ")}`
        );
        const bookTokens = new Set(tokenize(text));
        let score = sharedTokenCount(targetTokens, bookTokens) * 12;
        const titleOverlap = sharedTokenCount(new Set(tokenize(primaryBook.title || "")), new Set(tokenize(getBookTitle(book))));
        score += titleOverlap * 20;
        return { book, score };
      })
      .sort((a, b) => b.score - a.score)
      .filter((item) => item.score > 0)
      .slice(0, Math.max(1, Math.min(10, topK * 3)));

    const reranked = await this.semanticRerank(
      `${primaryBook.title || ""} ${primaryBook.description || ""}`,
      scored.map((item) => ({ book: item.book, score: item.score }))
    );

    return reranked.slice(0, topK).map((item) => this.normalizeBook(item.book));
  }

  buildSummaryFallbackText(payload, maxTokens) {
    const title = payload?.book?.title || "Selected title";
    const authorText = (payload?.book?.authors || []).join(", ") || "Unknown author";
    const desc = payload?.book?.description || "Description is limited for this title.";
    const takeawaysText = (payload?.key_takeaways || []).map((line, idx) => `${idx + 1}. ${line}`).join(" ");
    const similarText = (payload?.similar_books || [])
      .map((book) => getBookTitle(book))
      .filter(Boolean)
      .slice(0, 4)
      .join(", ");

    const text = [
      `Here is a detailed summary for "${title}" by ${authorText}.`,
      truncateWords(desc, 130),
      takeawaysText ? `Key takeaways: ${takeawaysText}` : "",
      similarText ? `If this matches your taste, consider: ${similarText}.` : "",
      `Why this recommendation is reliable: it blends metadata relevance, semantic similarity, and contextual enrichment.`,
    ]
      .filter(Boolean)
      .join(" ");

    return truncateWords(stripLinks(text), Math.max(260, maxTokens));
  }

  async detectSummaryEntityType(query, explicitType, catalogAuthors) {
    const type = String(explicitType || "auto").toLowerCase();
    if (type !== "auto") {
      return type;
    }

    const q = String(query || "");
    const qNorm = normalizeText(q);
    if (/\b(publisher|published by|publication|imprint)\b/i.test(q)) {
      return "publisher";
    }
    if (/\b(author|writer|written by|who wrote|books by)\b/i.test(q)) {
      return "author";
    }

    const matchedCatalogAuthor = (catalogAuthors || []).some((author) => {
      const n = normalizeText(author?.name || "");
      return n && qNorm.includes(n);
    });
    if (matchedCatalogAuthor) {
      return "author";
    }

    const intent = await this.decideWithTransformers(q);
    if (intent?.mode === "author") {
      return "author";
    }
    if (intent?.mode === "publisher") {
      return "publisher";
    }
    return "book";
  }

  pickLikelyAuthorName(query, explicitAuthor, catalogAuthors, candidates) {
    if (explicitAuthor) {
      return stripLinks(explicitAuthor);
    }

    const qNorm = normalizeText(query);
    const dbMatch = (catalogAuthors || []).find((author) => {
      const n = normalizeText(author?.name || "");
      return n && qNorm.includes(n);
    });
    if (dbMatch?.name) {
      return dbMatch.name;
    }

    const authorCount = new Map();
    for (const candidate of candidates || []) {
      for (const name of candidate?.authors || []) {
        const key = stripLinks(name);
        if (!key) continue;
        authorCount.set(key, (authorCount.get(key) || 0) + 1);
      }
    }
    const top = [...authorCount.entries()].sort((a, b) => b[1] - a[1])[0];
    return top?.[0] || "";
  }

  pickLikelyPublisherName(query, candidates) {
    const qNorm = normalizeText(query);
    const pubCount = new Map();
    for (const candidate of candidates || []) {
      const pub = stripLinks(candidate?.publisher || "");
      if (!pub) continue;
      const key = normalizeText(pub);
      const boost = qNorm.includes(key) ? 3 : 1;
      pubCount.set(pub, (pubCount.get(pub) || 0) + boost);
    }
    const top = [...pubCount.entries()].sort((a, b) => b[1] - a[1])[0];
    return top?.[0] || "";
  }

  buildAuthorProfileFromCandidates(authorName, candidates) {
    const target = normalizeText(authorName);
    const filtered = (candidates || []).filter((book) => {
      const names = (book?.authors || []).map((n) => normalizeText(n));
      if (!target) {
        return names.length > 0;
      }
      return names.some((name) => name === target || name.includes(target) || target.includes(name));
    });
    const books = filtered.length ? filtered : candidates.slice(0, 5);

    const categories = new Map();
    const publishers = new Map();
    for (const book of books) {
      for (const c of book?.categories || []) {
        categories.set(c, (categories.get(c) || 0) + 1);
      }
      const p = stripLinks(book?.publisher || "");
      if (p) {
        publishers.set(p, (publishers.get(p) || 0) + 1);
      }
    }

    return {
      name: authorName || (books[0]?.authors || [])[0] || "Unknown author",
      books,
      top_categories: [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name),
      top_publishers: [...publishers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name),
    };
  }

  buildPublisherProfileFromCandidates(publisherName, candidates) {
    const target = normalizeText(publisherName);
    const filtered = (candidates || []).filter((book) => {
      const p = normalizeText(book?.publisher || "");
      if (!target) {
        return !!p;
      }
      return p === target || p.includes(target) || target.includes(p);
    });
    const books = filtered.length ? filtered : candidates.slice(0, 5);

    const categories = new Map();
    const authors = new Map();
    for (const book of books) {
      for (const c of book?.categories || []) {
        categories.set(c, (categories.get(c) || 0) + 1);
      }
      for (const a of book?.authors || []) {
        authors.set(a, (authors.get(a) || 0) + 1);
      }
    }

    return {
      name: publisherName || books[0]?.publisher || "Unknown publisher",
      books,
      top_categories: [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name),
      top_authors: [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name),
    };
  }

  buildAuthorSummaryFallbackText(profile, wikiContext, maxTokens) {
    const titles = (profile?.books || []).slice(0, 5).map((b) => b.title).filter(Boolean).join(", ");
    const categories = (profile?.top_categories || []).join(", ") || "not enough category data";
    const publishers = (profile?.top_publishers || []).join(", ") || "publisher data is sparse";
    const text = [
      `Author profile summary: ${profile?.name || "Unknown author"}.`,
      wikiContext?.extract ? `Context: ${truncateWords(wikiContext.extract, 60)}` : "",
      titles ? `Known books from retrieved sources include: ${titles}.` : "",
      `Common category signals: ${categories}.`,
      `Frequent publishing links: ${publishers}.`,
      `This profile is generated by combining metadata, semantic matching, and intent analysis.`,
    ]
      .filter(Boolean)
      .join(" ");
    return truncateWords(stripLinks(text), Math.max(260, maxTokens));
  }

  buildPublisherSummaryFallbackText(profile, wikiContext, maxTokens) {
    const titles = (profile?.books || []).slice(0, 5).map((b) => b.title).filter(Boolean).join(", ");
    const categories = (profile?.top_categories || []).join(", ") || "not enough category data";
    const authors = (profile?.top_authors || []).join(", ") || "author distribution is sparse";
    const text = [
      `Publisher profile summary: ${profile?.name || "Unknown publisher"}.`,
      wikiContext?.extract ? `Context: ${truncateWords(wikiContext.extract, 60)}` : "",
      titles ? `Representative titles include: ${titles}.` : "",
      `Dominant categories: ${categories}.`,
      `Frequent associated authors: ${authors}.`,
      `This summary is grounded in external catalog metadata and semantic ranking.`,
    ]
      .filter(Boolean)
      .join(" ");
    return truncateWords(stripLinks(text), Math.max(260, maxTokens));
  }

  async summarizeBook(request) {
    const {
      query,
      author = "",
      entity_type = "auto",
      language = "en",
      tone = "insightful",
      include_quotes = true,
      include_key_takeaways = true,
      include_similar_books = true,
      max_tokens = 700,
      top_k_similar = 4,
    } = request || {};

    const { books: catalogBooks, authors: catalogAuthors } = await this.fetchCatalog();
    const searchQuery = [query, author].filter(Boolean).join(" ").trim();
    const candidates = await this.fetchGoogleSummaryCandidates(searchQuery || query, language, 8);
    if (!candidates.length) {
      throw new Error("No external books found for this query.");
    }
    const detectedEntityType = await this.detectSummaryEntityType(query, entity_type, catalogAuthors);

    if (detectedEntityType === "author") {
      const authorName = this.pickLikelyAuthorName(query, author, catalogAuthors, candidates);
      const profile = this.buildAuthorProfileFromCandidates(authorName, candidates);
      const wikiContext = await this.fetchWikipediaExtract(`${profile.name} author`);
      const keyTakeaways = include_key_takeaways
        ? [
            `Top author focus: ${profile.name}.`,
            `Most visible categories: ${(profile.top_categories || []).join(", ") || "not enough signals"}.`,
            `Frequent publisher links: ${(profile.top_publishers || []).join(", ") || "not enough signals"}.`,
          ]
        : [];
      const quoteLines = include_quotes
        ? [
            `${profile.name}'s writing footprint is best understood through recurring themes, not isolated titles.`,
            `A strong author signal appears when category consistency and reader intent align.`,
          ]
        : [];
      const seed = {
        title: profile.name,
        description: `Author profile for ${profile.name}`,
        authors: [profile.name],
        categories: profile.top_categories || [],
      };
      const similarBooks = include_similar_books
        ? await this.buildSimilarBooksForSummary(seed, catalogBooks, top_k_similar)
        : [];

      const summaryContext = JSON.stringify({
        entity_type: "author",
        query,
        tone,
        author_profile: profile,
        wiki_context: wikiContext?.extract || "",
        key_takeaways: keyTakeaways,
        quote_lines: quoteLines,
      });
      const llamaResult = await this.generateWithLlama(
        `Generate an NLP-rich, elaborative author profile summary in a ${tone} tone with practical reader guidance.`,
        summaryContext,
        Math.max(420, max_tokens)
      );
      const result = llamaResult || this.buildAuthorSummaryFallbackText(profile, wikiContext, max_tokens);

      const matchedAuthors = (catalogAuthors || [])
        .filter((a) => normalizeText(a?.name || "") === normalizeText(profile.name))
        .map((a) => this.normalizeAuthor(a));

      return {
        result,
        intent: { entity_type: "author", detected_from: entity_type === "auto" ? "auto" : "explicit" },
        source: {
          primary: "google_books_api",
          enrichment: wikiContext ? "wikipedia_api" : null,
          nlp: this.semantic.enabled ? "transformers" : "keyword_fallback",
        },
        summary_for: {
          type: "author",
          name: profile.name,
          top_categories: profile.top_categories,
          top_publishers: profile.top_publishers,
          known_titles: profile.books.slice(0, 6).map((b) => b.title).filter(Boolean),
        },
        key_takeaways: keyTakeaways,
        quote_lines: quoteLines,
        similar_books: similarBooks,
        matched_authors: matchedAuthors,
      };
    }

    if (detectedEntityType === "publisher") {
      const publisherName = this.pickLikelyPublisherName(query, candidates);
      const profile = this.buildPublisherProfileFromCandidates(publisherName, candidates);
      const wikiContext = await this.fetchWikipediaExtract(`${profile.name} publisher`);
      const keyTakeaways = include_key_takeaways
        ? [
            `Publisher focus: ${profile.name}.`,
            `Category concentration: ${(profile.top_categories || []).join(", ") || "not enough signals"}.`,
            `Frequent author associations: ${(profile.top_authors || []).join(", ") || "not enough signals"}.`,
          ]
        : [];
      const quoteLines = include_quotes
        ? [
            `${profile.name} stands out through portfolio shape, not just a single bestseller.`,
            `Publisher identity usually appears in recurring category and author patterns.`,
          ]
        : [];
      const seed = {
        title: profile.name,
        description: `Publisher profile for ${profile.name}`,
        authors: profile.top_authors || [],
        categories: profile.top_categories || [],
      };
      const similarBooks = include_similar_books
        ? await this.buildSimilarBooksForSummary(seed, catalogBooks, top_k_similar)
        : [];

      const summaryContext = JSON.stringify({
        entity_type: "publisher",
        query,
        tone,
        publisher_profile: profile,
        wiki_context: wikiContext?.extract || "",
        key_takeaways: keyTakeaways,
        quote_lines: quoteLines,
      });
      const llamaResult = await this.generateWithLlama(
        `Generate an NLP-rich, elaborative publisher profile summary in a ${tone} tone with market and catalog insights.`,
        summaryContext,
        Math.max(420, max_tokens)
      );
      const result = llamaResult || this.buildPublisherSummaryFallbackText(profile, wikiContext, max_tokens);

      return {
        result,
        intent: { entity_type: "publisher", detected_from: entity_type === "auto" ? "auto" : "explicit" },
        source: {
          primary: "google_books_api",
          enrichment: wikiContext ? "wikipedia_api" : null,
          nlp: this.semantic.enabled ? "transformers" : "keyword_fallback",
        },
        summary_for: {
          type: "publisher",
          name: profile.name,
          top_categories: profile.top_categories,
          top_authors: profile.top_authors,
          representative_titles: profile.books.slice(0, 6).map((b) => b.title).filter(Boolean),
        },
        key_takeaways: keyTakeaways,
        quote_lines: quoteLines,
        similar_books: similarBooks,
      };
    }

    const rankedCandidates = candidates
      .map((candidate) => ({
        candidate,
        score: this.scoreSummaryCandidate(candidate, query, author),
      }))
      .sort((a, b) => b.score - a.score);
    const primary = rankedCandidates[0]?.candidate;
    if (!primary) {
      throw new Error("Unable to rank an external book candidate.");
    }

    const wikiContext = await this.fetchWikipediaExtract(
      [primary.title, (primary.authors || [])[0]].filter(Boolean).join(" ")
    );
    const keyTakeaways = include_key_takeaways ? this.buildKeyTakeaways(primary, wikiContext, 5) : [];
    const quoteLines = include_quotes ? this.buildInspiredQuoteLines(primary, wikiContext, 3) : [];
    const similarBooks = include_similar_books
      ? await this.buildSimilarBooksForSummary(primary, catalogBooks, top_k_similar)
      : [];

    const summaryContext = JSON.stringify({
      query,
      author,
      tone,
      book: primary,
      wiki_context: wikiContext?.extract || "",
      key_takeaways: keyTakeaways,
      quote_lines: quoteLines,
      similar_books: similarBooks.map((book) => ({
        title: getBookTitle(book),
        authors: getBookAuthorNames(book),
        category: getBookCategoryNames(book),
        price: getBookPrimarySellingPrice(book),
      })),
    });

    const llamaResult = await this.generateWithLlama(
      `Generate an elaborative NLP summary for the selected book in a ${tone} tone. Include a clear structure, nuanced interpretation, and reader guidance.`,
      summaryContext,
      Math.max(420, max_tokens)
    );

    const summaryText =
      llamaResult ||
      this.buildSummaryFallbackText(
        {
          book: primary,
          key_takeaways: keyTakeaways,
          similar_books: similarBooks,
        },
        max_tokens
      );

    return {
      result: summaryText,
      intent: { entity_type: "book", detected_from: entity_type === "auto" ? "auto" : "explicit" },
      source: {
        primary: "google_books_api",
        enrichment: wikiContext ? "wikipedia_api" : null,
        nlp: this.semantic.enabled ? "transformers" : "keyword_fallback",
      },
      summary_for: {
        type: "book",
        title: primary.title,
        subtitle: primary.subtitle || null,
        authors: primary.authors,
        publisher: primary.publisher || null,
        categories: primary.categories,
        published_date: primary.published_date,
        page_count: primary.page_count,
        average_rating: primary.average_rating,
        ratings_count: primary.ratings_count,
        language: primary.language,
        image: primary.image,
      },
      key_takeaways: keyTakeaways,
      quote_lines: quoteLines,
      similar_books: similarBooks,
    };
  }

  async fetchGoogleHints(prompt) {
    const url = this.buildGoogleBooksUrl(prompt);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return {
        hintTokens: new Set(),
        titleTokenSets: [],
        authors: new Set(),
        categories: new Set(),
      };
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];

    const hintTokens = new Set();
    const titleTokenSets = [];
    const authors = new Set();
    const categories = new Set();

    for (const item of items) {
      const info = item?.volumeInfo || {};
      const title = stripLinks(info.title || "");
      const description = stripLinks(info.description || "");
      const titleTokens = new Set(tokenize(title));
      titleTokenSets.push(titleTokens);

      for (const token of tokenize(`${title} ${description}`)) {
        hintTokens.add(token);
      }

      if (Array.isArray(info.authors)) {
        for (const name of info.authors) {
          const cleanName = stripLinks(name).toLowerCase();
          if (cleanName) {
            authors.add(cleanName);
          }
          for (const token of tokenize(cleanName)) {
            hintTokens.add(token);
          }
        }
      }

      if (Array.isArray(info.categories)) {
        for (const category of info.categories) {
          const cleanCategory = stripLinks(category).toLowerCase();
          if (cleanCategory) {
            categories.add(cleanCategory);
          }
          for (const token of tokenize(cleanCategory)) {
            hintTokens.add(token);
          }
        }
      }
    }

    return { hintTokens, titleTokenSets, authors, categories };
  }

  buildOpenLibraryUrl(query) {
    const params = new URLSearchParams({
      q: query,
      limit: "10",
      language: "eng",
    });
    return `${this.openLibraryApi}?${params.toString()}`;
  }

  async fetchOpenLibraryHints(prompt) {
    const url = this.buildOpenLibraryUrl(prompt);
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return {
        titleTokenSets: [],
        authors: new Set(),
        categories: new Set(),
      };
    }

    const payload = await response.json();
    const docs = Array.isArray(payload?.docs) ? payload.docs : [];
    const titleTokenSets = [];
    const authors = new Set();
    const categories = new Set();

    for (const doc of docs) {
      const title = stripLinks(doc?.title || "");
      titleTokenSets.push(new Set(tokenize(title)));
      for (const name of Array.isArray(doc?.author_name) ? doc.author_name : []) {
        const clean = stripLinks(name).toLowerCase();
        if (clean) {
          authors.add(clean);
        }
      }
      for (const subject of Array.isArray(doc?.subject) ? doc.subject : []) {
        const clean = stripLinks(subject).toLowerCase();
        if (clean) {
          categories.add(clean);
        }
      }
    }

    return { titleTokenSets, authors, categories };
  }

  async fetchExternalHints(prompt) {
    const [google, openLibrary] = await Promise.all([
      this.fetchGoogleHints(prompt).catch(() => ({
        hintTokens: new Set(),
        titleTokenSets: [],
        authors: new Set(),
        categories: new Set(),
      })),
      this.fetchOpenLibraryHints(prompt).catch(() => ({
        titleTokenSets: [],
        authors: new Set(),
        categories: new Set(),
      })),
    ]);

    return {
      hintTokens: google.hintTokens || new Set(),
      titleTokenSets: [...(google.titleTokenSets || []), ...(openLibrary.titleTokenSets || [])],
      authors: new Set([...(google.authors || []), ...(openLibrary.authors || [])]),
      categories: new Set([...(google.categories || []), ...(openLibrary.categories || [])]),
    };
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
    const rawBook = JSON.parse(JSON.stringify(book || {}));
    rawBook.characters = extractCharacterCandidates(getBookDescription(rawBook));
    return rawBook;
  }

  normalizeAuthor(author) {
    return JSON.parse(JSON.stringify(author || {}));
  }

  parseQueryConstraints(prompt, books, authors) {
    const promptText = String(prompt || "");
    const promptLower = promptText.toLowerCase();
    const promptNorm = normalizeText(promptText);

    const maxPriceMatch = promptText.match(
      /\b(under|below|less than|upto|up to)\s*(?:rs\.?|inr)?\s*(\d+(?:\.\d+)?)\b/i
    );
    const minPriceMatch = promptText.match(
      /\b(?:above|over|more than|greater than)\s*(?:rs\.?|inr)?\s*(\d+(?:\.\d+)?)\b/i
    );

    const maxPrice = maxPriceMatch ? toNumberOrNull(maxPriceMatch[2]) : null;
    const minPrice = minPriceMatch ? toNumberOrNull(minPriceMatch[1]) : null;
    const maxPriceStrict = !!maxPriceMatch && !/(upto|up to)/i.test(maxPriceMatch[1]);
    const hasPriceConstraint = maxPrice !== null || minPrice !== null;

    const allCategories = new Set(
      books.flatMap((book) => getBookCategoryNames(book).map((name) => name.toLowerCase()))
    );
    const explicitCategories = [...allCategories].filter((cat) => promptLower.includes(cat));

    const genreHints = [
      "fiction",
      "non fiction",
      "romance",
      "mythology",
      "thriller",
      "finance",
      "self help",
      "business",
    ].filter((hint) => promptLower.includes(hint));

    const mentionedAuthors = authors
      .map((author) => String(author?.name || "").trim())
      .filter((name) => name && promptNorm.includes(normalizeText(name)));

    const queryChunks = buildQueryChunks(promptText);

    return {
      maxPrice,
      minPrice,
      maxPriceStrict,
      hasPriceConstraint,
      explicitCategories,
      genreHints,
      mentionedAuthors,
      queryChunks,
      hasHardFilters:
        hasPriceConstraint ||
        explicitCategories.length > 0 ||
        genreHints.length > 0 ||
        mentionedAuthors.length > 0,
    };
  }

  evaluateBookAgainstConstraints(book, constraints) {
    const sellingPrice = toNumberOrNull(getBookPrimarySellingPrice(book));
    const authorNames = getBookAuthorNames(book);
    const categoryNames = getBookCategoryNames(book).map((name) => name.toLowerCase());
    const searchBlob = normalizeText(
      `${book?.title || ""} ${getBookDescription(book)} ${authorNames.join(" ")} ${categoryNames.join(" ")}`
    );

    const hits = {
      title: false,
      author: false,
      category: false,
      description: false,
      price: false,
      genre: false,
      chunks: 0,
    };

    const titleNorm = normalizeText(book?.title || "");
    const promptNorm = normalizeText(
      `${constraints.mentionedAuthors.join(" ")} ${constraints.explicitCategories.join(" ")} ${constraints.genreHints.join(" ")}`
    );
    if (promptNorm && titleNorm && promptNorm.includes(titleNorm)) {
      hits.title = true;
    }

    if (constraints.mentionedAuthors.length) {
      hits.author = constraints.mentionedAuthors.some((name) =>
        authorNames.some((bookAuthor) => normalizeText(bookAuthor) === normalizeText(name))
      );
    } else if (authorNames.length) {
      hits.author = true;
    }

    if (constraints.explicitCategories.length) {
      hits.category = constraints.explicitCategories.some((cat) =>
        categoryNames.includes(cat.toLowerCase())
      );
    } else if (categoryNames.length) {
      hits.category = true;
    }

    hits.description = searchBlob.length > 0;

    if (constraints.hasPriceConstraint) {
      if (sellingPrice !== null) {
        const maxOkay =
          constraints.maxPrice === null
            ? true
            : constraints.maxPriceStrict
              ? sellingPrice < constraints.maxPrice
              : sellingPrice <= constraints.maxPrice;
        const minOkay = constraints.minPrice === null || sellingPrice >= constraints.minPrice;
        hits.price = maxOkay && minOkay;
      } else {
        hits.price = false;
      }
    } else {
      hits.price = true;
    }

    if (constraints.genreHints.length) {
      hits.genre = constraints.genreHints.some((hint) => searchBlob.includes(hint));
    } else {
      hits.genre = true;
    }

    let chunkHits = 0;
    for (const chunk of constraints.queryChunks) {
      if (chunk && searchBlob.includes(chunk)) {
        chunkHits += 1;
      }
    }
    hits.chunks = chunkHits;

    const hardPass =
      (!constraints.mentionedAuthors.length || hits.author) &&
      (!constraints.explicitCategories.length || hits.category) &&
      (!constraints.hasPriceConstraint || hits.price) &&
      (!constraints.genreHints.length || hits.genre);

    const matchedFieldCount = [
      hits.title,
      hits.author,
      hits.category,
      hits.description,
      hits.price,
      hits.genre,
    ].filter(Boolean).length;
    const chunkCoverage = constraints.queryChunks.length
      ? chunkHits / constraints.queryChunks.length
      : 0;

    return {
      hardPass,
      matchedFieldCount,
      chunkCoverage,
    };
  }

  scoreBook(book, promptLower, promptTokensSet, googleHints, intent) {
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

    if (intent?.asksFinance) {
      if (bookIsFinanceHeavy || /\bfinance|financial|money|wealth|rich dad\b/i.test(`${title} ${description}`)) {
        score += 140;
      } else {
        score -= 60;
      }
    }
    if (intent?.asksRomance) {
      if (bookIsRomanceHeavy) {
        score += 95;
      } else {
        score -= 45;
      }
    }
    if (intent?.asksMythology) {
      if (bookIsMythologyHeavy || /\bhidden hindu|mritsanjeevani|om shastri|nagendra\b/i.test(`${title} ${description}`)) {
        score += 110;
      } else {
        score -= 45;
      }
    }

    if (googleHints) {
      const localTitleTokens = new Set(tokenize(title));
      const localAuthorSet = new Set(authors);
      const localCategorySet = new Set(categories);

      for (const remoteTitleTokens of googleHints.titleTokenSets) {
        const titleMatch = sharedTokenCount(localTitleTokens, remoteTitleTokens);
        score += titleMatch * 8;
      }

      for (const authorName of localAuthorSet) {
        if (googleHints.authors.has(authorName)) {
          score += 45;
        }
      }

      for (const localCategory of localCategorySet) {
        for (const remoteCategory of googleHints.categories) {
          const localTokens = new Set(tokenize(localCategory));
          const remoteTokens = new Set(tokenize(remoteCategory));
          const categoryMatch = sharedTokenCount(localTokens, remoteTokens);
          score += categoryMatch * 6;
        }
      }
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
      matchedBooks.flatMap((book) => getBookAuthorNames(book))
    );
    if (matchedBookAuthors.has(author?.name)) {
      score += 12;
    }

    return score;
  }

  async matchBooks(prompt, books, limit = 5) {
    const promptLower = String(prompt || "").toLowerCase();
    const promptTokensSet = new Set(tokenize(prompt));
    const intent = detectIntent(prompt);
    const googleHints = await this.fetchExternalHints(prompt);
    const constraints = this.parseQueryConstraints(prompt, books, this.cache.authors || []);

    const scored = books
      .map((book) => {
        const baseScore = this.scoreBook(book, promptLower, promptTokensSet, googleHints, intent);
        const evalResult = this.evaluateBookAgainstConstraints(book, constraints);
        const fieldBoost = evalResult.matchedFieldCount * 45;
        const chunkBoost = evalResult.chunkCoverage * 120;
        const hardFilterPenalty = evalResult.hardPass ? 0 : -300;
        return {
          score: baseScore + fieldBoost + chunkBoost + hardFilterPenalty,
          matchedFieldCount: evalResult.matchedFieldCount,
          hardPass: evalResult.hardPass,
          book,
        };
      })
      .sort((a, b) => b.score - a.score);

    const hardPassed = scored.filter((item) => item.hardPass);

    const pool = hardPassed.length ? hardPassed : scored;
    const semanticWindow = pool.slice(0, Math.min(15, pool.length));
    const semanticallyRerankedTop = await this.semanticRerank(prompt, semanticWindow);
    const seenIds = new Set();
    const mergedPool = [];
    for (const item of semanticallyRerankedTop) {
      const id = item?.book?.id;
      if (id !== undefined && id !== null) {
        seenIds.add(id);
      }
      mergedPool.push(item);
    }
    for (const item of pool) {
      const id = item?.book?.id;
      if (id !== undefined && id !== null && seenIds.has(id)) {
        continue;
      }
      mergedPool.push(item);
    }

    const maxFieldCount = mergedPool.length
      ? Math.max(...mergedPool.map((item) => item.matchedFieldCount))
      : 0;
    const strongMatches = mergedPool
      .filter((item) => item.score > 0 && item.matchedFieldCount >= Math.max(1, maxFieldCount - 1))
      .slice(0, limit);

    if (strongMatches.length) {
      return strongMatches.map((item) => this.normalizeBook(item.book));
    }

    return scored.slice(0, Math.min(3, scored.length)).map((item) => this.normalizeBook(item.book));
  }

  matchAuthors(prompt, authors, matchedBooks, limit = 5) {
    const promptLower = String(prompt || "").toLowerCase();
    const promptTokensSet = new Set(tokenize(prompt));
    const intent = detectIntent(prompt);

    const scored = authors
      .map((author) => ({
        score: this.scoreAuthor(author, promptLower, promptTokensSet, matchedBooks),
        author,
      }))
      .sort((a, b) => b.score - a.score);

    const minimumAuthorScore = intent.asksAuthor ? 20 : 65;
    const strongMatches = scored.filter((item) => item.score >= minimumAuthorScore).slice(0, limit);
    if (strongMatches.length) {
      return strongMatches.map((item) => this.normalizeAuthor(item.author));
    }

    // Fallback: if top matched books have known author names in DB, return those authors.
    const matchedBookAuthorNames = new Set(
      matchedBooks.flatMap((book) => getBookAuthorNames(book))
    );
    const fallback = authors
      .filter((author) => matchedBookAuthorNames.has(stripLinks(author?.name)))
      .slice(0, limit)
      .map((author) => this.normalizeAuthor(author));

    return fallback;
  }

  postFilterByIntent(prompt, matchedBooks, matchedAuthors, aiMode = "general") {
    const intent = detectIntent(prompt);
    const modeHint = aiMode || (intent.asksAuthor
      ? "author"
      : intent.asksPublisher
        ? "publisher"
        : intent.asksPrice
          ? "price"
          : "general");
    const constraints = this.parseQueryConstraints(prompt, this.cache.books || [], this.cache.authors || []);
    let books = [...matchedBooks];
    let authors = [...matchedAuthors];

    // Apply strict constraint filters so final payload matches user intent.
    books = books.filter((book) => {
      const price = toNumberOrNull(getBookPrimarySellingPrice(book));
      const authorNames = getBookAuthorNames(book).map((n) => normalizeText(n));
      const categoryNames = getBookCategoryNames(book).map((n) => normalizeText(n));
      const searchable = normalizeText(
        `${getBookTitle(book)} ${getBookDescription(book)} ${authorNames.join(" ")} ${categoryNames.join(" ")}`
      );

      if (constraints.hasPriceConstraint) {
        if (price === null) return false;
        if (constraints.maxPrice !== null) {
          const maxOk = constraints.maxPriceStrict ? price < constraints.maxPrice : price <= constraints.maxPrice;
          if (!maxOk) return false;
        }
        if (constraints.minPrice !== null && price < constraints.minPrice) return false;
      }

      if (constraints.mentionedAuthors.length) {
        const match = constraints.mentionedAuthors.some((name) =>
          authorNames.includes(normalizeText(name))
        );
        if (!match) return false;
      }

      if (constraints.explicitCategories.length) {
        const match = constraints.explicitCategories.some((cat) =>
          categoryNames.includes(normalizeText(cat))
        );
        if (!match) return false;
      }

      if (constraints.genreHints.length) {
        const match = constraints.genreHints.some((hint) => searchable.includes(normalizeText(hint)));
        if (!match) return false;
      }

      return true;
    });

    if (modeHint === "author") {
      const authorNameSet = new Set(authors.map((a) => normalizeText(a?.name || "")));
      books = books.filter((book) => {
        const names = getBookAuthorNames(book).map((n) => normalizeText(n));
        if (!names.length) {
          return false;
        }
        if (!authorNameSet.size) {
          return true;
        }
        return names.some((name) => authorNameSet.has(name));
      });

      if (!authors.length && books.length) {
        const fallbackNames = new Set(
          books.flatMap((book) => getBookAuthorNames(book).map((n) => normalizeText(n)))
        );
        authors = this.cache.authors
          .filter((author) => fallbackNames.has(normalizeText(author?.name || "")))
          .map((author) => this.normalizeAuthor(author));
      }
    }

    const shouldIncludeAuthors =
      modeHint === "author" ||
      modeHint === "publisher" ||
      intent.asksAuthor ||
      constraints.mentionedAuthors.length > 0;

    if (shouldIncludeAuthors && !authors.length && constraints.mentionedAuthors.length) {
      const mentioned = new Set(constraints.mentionedAuthors.map((name) => normalizeText(name)));
      authors = (this.cache.authors || [])
        .filter((author) => mentioned.has(normalizeText(author?.name || "")))
        .map((author) => this.normalizeAuthor(author));
    }

    if (!shouldIncludeAuthors) {
      authors = [];
    }

    const requestedCount = this.extractRequestedCount(prompt, 3);
    return {
      books: books.slice(0, requestedCount),
      authors: authors.slice(0, 3),
      display: {
        show_book_cards: books.length > 0,
        show_author_cards: authors.length > 0,
      },
    };
  }

  extractRequestedCount(prompt, fallback = 3) {
    const text = String(prompt || "").toLowerCase();
    if (/\b(best|top)\s+book\b/.test(text) || /\ba\s+book\b/.test(text)) {
      return 1;
    }
    const match = String(prompt || "").match(/\b(?:top|best|show|give|list)\s+(\d+)\b/i);
    if (!match) {
      return fallback;
    }
    const n = Number(match[1]);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return Math.max(1, Math.min(10, n));
  }

  slimBookForIntent(book, mode) {
    if (!book) {
      return book;
    }
    if (mode === "author") {
      return {
        id: book.id,
        title: getBookTitle(book),
        authors: book.authors,
      };
    }
    if (mode === "price") {
      return {
        id: book.id,
        title: getBookTitle(book),
        price: book.price,
        authors: book.authors,
      };
    }
    return {
      id: book.id,
      title: getBookTitle(book),
      description: truncateWords(getBookDescription(book), 40),
      image: book.image,
      authors: book.authors,
      price: book.price,
      categories: book.categories,
    };
  }

  slimAuthorForIntent(author, mode, forceFull = false) {
    if (!author) {
      return author;
    }
    if (forceFull || mode === "author" || mode === "publisher") {
      return author;
    }
    return {
      id: author.id,
      name: author.name,
      pen_name: author.pen_name || null,
    };
  }

  async generateWithLlama(prompt, context, maxNewTokens) {
    if (!this.hfToken) {
      return null;
    }
    const endpoint = `https://api-inference.huggingface.co/models/${this.llamaModel}`;
    const systemInstruction =
      "You are a smart bookstore AI assistant. Produce rich, engaging, human-like long-form answers grounded only in provided catalog context. Avoid rigid templates and avoid hallucinations.";
    const composedPrompt = `<|system|>\n${systemInstruction}\n<|user|>\nUser query: ${prompt}\nContext: ${context}\n<|assistant|>\n`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.hfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: composedPrompt,
        parameters: {
          max_new_tokens: Math.min(900, Math.max(220, maxNewTokens)),
          temperature: 0.72,
          top_p: 0.92,
          return_full_text: false,
        },
        options: {
          wait_for_model: true,
        },
      }),
    });

    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const text = Array.isArray(payload) ? payload?.[0]?.generated_text : null;
    if (!text || typeof text !== "string") {
      return null;
    }
    return stripLinks(text.trim());
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
      const authorNames = getBookAuthorNames(firstBook);
      const authorText = authorNames.length
        ? authorNames.join(", ")
        : "author details are not listed";
      return `For "${firstBook.title}", the listed author is ${authorText}.`;
    }

    const primary = matchedAuthors[0];
    const bio = primary.bio ? truncateWords(primary.bio, 30) : "bio is not available in the author API";
    return `${primary.name} is a matching author in your database. Bio summary: ${bio}.`;
  }

  buildPriceAnswer(matchedBooks) {
    const priced = matchedBooks.filter((book) => getBookPrimarySellingPrice(book));
    if (!priced.length) {
      return "I found matching books, but selling prices are currently not listed for them.";
    }
    const lines = priced
      .slice(0, 3)
      .map((book) => `${book.title}: Rs. ${getBookPrimarySellingPrice(book)}`)
      .join("; ");
    return `Here are the latest listed prices from your catalog: ${lines}.`;
  }

  buildGeneralBookAnswer(prompt, matchedBooks, matchedAuthors, wikiContext) {
    const cleanPrompt = stripLinks(prompt);
    const topBook = matchedBooks[0];
    if (!topBook) {
      return `I checked your catalog for "${cleanPrompt}" but found no exact matches for all requested filters. Try broadening price, category, or author constraints.`;
    }

    const openingTemplates = [
      `I understood your request about "${cleanPrompt}". The strongest match is "${topBook.title}".`,
      `Got it for "${cleanPrompt}". The top match I found is "${topBook.title}".`,
      `Based on your query "${cleanPrompt}", the best match right now is "${topBook.title}".`,
      `For "${cleanPrompt}", the highest-confidence result in your catalog is "${topBook.title}".`,
      `Nice query: "${cleanPrompt}". The first recommendation I would give is "${topBook.title}".`,
      `After checking your catalog for "${cleanPrompt}", "${topBook.title}" stands out as the top match.`,
    ];
    const openLine = openingTemplates[Math.floor(Math.random() * openingTemplates.length)];

    const bookLines = matchedBooks.slice(0, 5).map((book, idx) => {
      const authorNames = getBookAuthorNames(book);
      const authorText = authorNames.length ? authorNames.join(", ") : "Unknown author";
      const description = truncateWords(getBookDescription(book), 60);
      const categoryText = Array.isArray(book?.categories)
        ? book.categories.map((c) => c?.name).filter(Boolean).join(", ")
        : "";
      const priceText = getBookPrimarySellingPrice(book)
        ? ` | Price: Rs. ${getBookPrimarySellingPrice(book)}`
        : "";
      const categoryPart = categoryText ? ` | Category: ${categoryText}` : "";
      return `${idx + 1}. ${book.title} by ${authorText}${categoryPart}${priceText}\n   ${description}`;
    });

    const authorLine = matchedAuthors.length
      ? `Matching author: ${matchedAuthors[0].name}.`
      : "No explicit author keyword was detected in your query.";

    const contextLine = wikiContext
      ? `Additional context: ${wikiContext.title} - ${wikiContext.extract}`
      : "Additional context: response is based on your internal catalog data.";

    return `${openLine}\n\nDetailed matches:\n${bookLines.join("\n\n")}\n\n${authorLine}\n${contextLine}`;
  }

  buildCatalogInsights(books, authors) {
    const totalBooks = books.length;
    const totalAuthors = authors.length;

    const categoryCount = new Map();
    const languageCount = new Map();
    const prices = [];

    for (const book of books) {
      const language = String(book?.language || "").trim();
      if (language) {
        languageCount.set(language, (languageCount.get(language) || 0) + 1);
      }

      if (Array.isArray(book?.categories)) {
        for (const category of book.categories) {
          const name = String(category?.name || "").trim();
          if (name) {
            categoryCount.set(name, (categoryCount.get(name) || 0) + 1);
          }
        }
      }

      const selling = toNumberOrNull(getBookPrimarySellingPrice(book));
      if (selling !== null) {
        prices.push(selling);
      }
    }

    const topCategories = [...categoryCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => `${name} (${count})`)
      .join(", ");

    const topLanguages = [...languageCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name, count]) => `${name} (${count})`)
      .join(", ");

    const lowestPrice = prices.length ? Math.min(...prices) : null;
    const highestPrice = prices.length ? Math.max(...prices) : null;

    const knownAuthor = [...authors]
      .sort((a, b) => (b?.book_count || 0) - (a?.book_count || 0))[0];
    const knownAuthorLine = knownAuthor?.name
      ? `Most represented author currently is ${knownAuthor.name} (${knownAuthor.book_count || 0} books).`
      : "Author distribution is currently limited in the catalog.";

    const priceLine =
      lowestPrice !== null && highestPrice !== null
        ? `Visible selling price range is Rs. ${lowestPrice.toFixed(2)} to Rs. ${highestPrice.toFixed(2)}.`
        : "Price metadata is limited for some catalog entries.";

    return `Catalog insights: ${totalBooks} books and ${totalAuthors} authors are currently indexed. Top categories: ${
      topCategories || "not enough category data"
    }. Main languages: ${topLanguages || "not enough language data"}. ${priceLine} ${knownAuthorLine}`;
  }

  isGreetingPrompt(prompt) {
    const text = normalizeText(prompt);
    return /\b(hi|hello|hey|good morning|good afternoon|good evening|namaste|yo)\b/i.test(text);
  }

  isInDomainPrompt(prompt, books, authors) {
    const text = normalizeText(prompt);
    const domainKeywords = [
      "book",
      "books",
      "author",
      "authors",
      "publisher",
      "publishers",
      "novel",
      "story",
      "stories",
      "read",
      "reading",
      "genre",
      "category",
      "price",
      "buy",
      "cart",
      "fiction",
      "non fiction",
      "finance",
      "romance",
      "mythology",
    ];

    if (domainKeywords.some((keyword) => text.includes(keyword))) {
      return true;
    }

    const hasAuthorMention = authors.some((author) => {
      const name = normalizeText(author?.name || "");
      return name && text.includes(name);
    });
    if (hasAuthorMention) {
      return true;
    }

    const hasBookMention = books.some((book) => {
      const title = normalizeText(getBookTitle(book));
      return title && text.includes(title);
    });
    if (hasBookMention) {
      return true;
    }

    return false;
  }

  buildGreetingResponse(prompt, suggestionBook) {
    const firstName = "there";
    const suggestionTitle = suggestionBook ? getBookTitle(suggestionBook) : "The Hidden Hindu 1";
    const suggestionPrice = suggestionBook
      ? getBookPrimarySellingPrice(suggestionBook)
      : null;
    const pricePart = suggestionPrice ? ` (Rs. ${suggestionPrice})` : "";

    return `Hey ${firstName}! :) Welcome to your book corner. I can help you discover books by author, price, category, and theme.\n\nHow are you feeling today, and what kind of read are you in the mood for?\n\nA quick one-book suggestion to start: "${suggestionTitle}"${pricePart}.`;
  }

  buildOutOfDomainResponse(suggestionBook) {
    const suggestionTitle = suggestionBook ? getBookTitle(suggestionBook) : "The Hidden Hindu 1";
    const suggestionPrice = suggestionBook
      ? getBookPrimarySellingPrice(suggestionBook)
      : null;
    const pricePart = suggestionPrice ? ` (Rs. ${suggestionPrice})` : "";

    return `I can only help with books, authors, publishers, pricing, and related catalog queries from this platform.\n\nIf you want, tell me your favorite genre or budget and I will find the best match for you. Which type of book should I suggest next?\n\nSingle-book suggestion: "${suggestionTitle}"${pricePart}.`;
  }

  buildGenerativeText(
    prompt,
    matchedBooks,
    matchedAuthors,
    wikiContext,
    maxNewTokens,
    catalogInsights,
    aiDecision
  ) {
    const mode = aiDecision?.mode || "general";
    const confidence = Number.isFinite(aiDecision?.confidence) ? aiDecision.confidence : 0;
    const openers = [
      `I processed your requirement and selected the most relevant result set.`,
      `I understood your request and picked matches using intent plus semantic ranking.`,
      `I parsed your constraints and returned only the strongest fit.`,
    ];

    const lines = [];
    const primary = matchedBooks[0];
    if (!primary) {
      return "I could not find a clean match for all constraints. Try changing one filter (price, author, category, or genre).";
    }

    if (mode === "author") {
      const authorText = matchedAuthors[0]?.name || getBookAuthorNames(primary)[0] || "Unknown author";
      lines.push(`Author focus: "${primary.title}" is associated with ${authorText}.`);
      lines.push(
        `This result is prioritized because author linkage in your catalog is stronger than competing titles for the same query intent.`
      );
    } else if (mode === "price") {
      const priceText = getBookPrimarySellingPrice(primary)
        ? `Rs. ${getBookPrimarySellingPrice(primary)}`
        : "price not listed";
      lines.push(`Price focus: "${primary.title}" is the strongest budget-fit candidate (${priceText}).`);
      lines.push(
        `I applied numeric budget filtering first and then semantic relevance ranking, so the shortlist remains accurate to both cost and content intent.`
      );
    } else if (mode === "character") {
      const chars = Array.isArray(primary.characters) ? primary.characters.slice(0, 3).join(", ") : "";
      lines.push(`Character focus: "${primary.title}"${chars ? ` with likely names ${chars}` : ""}.`);
      lines.push(
        `Character extraction is grounded in your catalog descriptions and then validated against semantic context from the query phrasing.`
      );
    } else {
      const categoryText = getBookCategoryNames(primary).join(", ") || "Uncategorized";
      lines.push(`Top recommendation: "${primary.title}" (${categoryText}).`);
      lines.push(
        `This selection balances intent similarity, metadata alignment, and multi-source retrieval signals to avoid shallow keyword-only ranking.`
      );
    }

    const shortlist = matchedBooks.slice(0, 3).map((book, idx) => {
      const price = getBookPrimarySellingPrice(book);
      const p = price ? `, Rs. ${price}` : "";
      return `${idx + 1}) ${book.title}${p}`;
    });
    if (shortlist.length > 1) {
      lines.push(`Shortlist: ${shortlist.join(" | ")}`);
      lines.push(
        `Each shortlisted option remains within the highest relevance band after post-filtering constraints and semantic reranking.`
      );
    }

    if (wikiContext?.extract) {
      lines.push(`Context signal: ${wikiContext.extract}`);
    }

    const confidenceTag =
      confidence >= 0.75 ? "high-confidence" : confidence >= 0.5 ? "moderate-confidence" : "exploratory";
    lines.push(`Decision profile: ${confidenceTag}.`);
    lines.push(
      `If you share one more constraint (tone, depth, pacing, or language), I can generate a highly personalized final recommendation note.`
    );
    lines.push(pickRandom([
      "If you want, I can narrow to one final pick.",
      "Tell me one extra preference and I will refine instantly.",
      "I can compare these in one line each if needed.",
    ]));

    const response = `${pickRandom(openers)} ${lines.join(" ")}`;
    return truncateWords(stripLinks(response), Math.max(220, maxNewTokens));
  }

  buildHelpfulInfoBlock(matchedBooks, matchedAuthors, wikiContext, catalogInsights) {
    const topBook = matchedBooks[0];
    const topBookTitle = topBook ? getBookTitle(topBook) : "No direct top match";
    const topBookPrice = topBook ? getBookPrimarySellingPrice(topBook) : null;
    const topAuthor = matchedAuthors[0]?.name || getBookAuthorNames(topBook || {})[0] || "Unknown";
    const topCategories = topBook ? getBookCategoryNames(topBook).slice(0, 2).join(", ") : "";
    const pricedBooks = matchedBooks
      .map((book) => ({
        book,
        price: toNumberOrNull(getBookPrimarySellingPrice(book)),
      }))
      .filter((item) => item.price !== null)
      .sort((a, b) => a.price - b.price);
    const bestBudget = pricedBooks[0] || null;

    const authorReason = (() => {
      if (!matchedAuthors.length) {
        return "No author keyword match was strongly detected for this query.";
      }
      const primaryAuthor = matchedAuthors[0]?.name || "";
      const authorBooks = matchedBooks.filter((book) =>
        getBookAuthorNames(book).some((name) => name.toLowerCase() === primaryAuthor.toLowerCase())
      );
      if (!authorBooks.length) {
        return `${primaryAuthor} matched from your author API, but book-level author metadata is sparse for some entries.`;
      }
      return `${primaryAuthor} is strongly linked to ${authorBooks.length} of the top matched book result(s).`;
    })();

    const categoryTrend = (() => {
      const categoryCount = new Map();
      for (const book of matchedBooks) {
        for (const category of getBookCategoryNames(book)) {
          categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
        }
      }
      const top = [...categoryCount.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) {
        return "No dominant category trend is visible in the current shortlist.";
      }
      return `${top[0]} appears most often in your top results (${top[1]} match${top[1] > 1 ? "es" : ""}).`;
    })();

    const infoLines = [
      `Helpful info:`,
      `- Top pick: ${topBookTitle}${topBookPrice ? ` (Rs. ${topBookPrice})` : ""}`,
      `- Best budget option: ${
        bestBudget ? `${getBookTitle(bestBudget.book)} (Rs. ${bestBudget.price.toFixed(2)})` : "No listed selling price in matched books"
      }`,
      `- Author signal: ${topAuthor}`,
      `- Strongest author-match reason: ${authorReason}`,
      topCategories ? `- Primary genre: ${topCategories}` : `- Primary genre: Not clearly tagged`,
      `- Category trend: ${categoryTrend}`,
    ];

    if (wikiContext?.extract) {
      infoLines.push(`- Context highlight: ${truncateWords(wikiContext.extract, 22)}`);
    }

    infoLines.push(`- Catalog snapshot: ${truncateWords(catalogInsights, 20)}`);
    return infoLines.join("\n");
  }

  async generate(prompt, maxNewTokens = 256) {
    const { books, authors } = await this.fetchCatalog();
    if (!books.length) {
      throw new Error("No books found in the database API response.");
    }

    const suggestionBook = books[0] || null;
    const aiDecision = await this.decideWithTransformers(prompt);

    if (aiDecision.mode === "greeting" || this.isGreetingPrompt(prompt)) {
      const greetingText = this.buildGreetingResponse(prompt, suggestionBook);
      return {
        result: truncateWords(greetingText, Math.max(80, maxNewTokens)),
        matched_books: suggestionBook ? [this.normalizeBook(suggestionBook)] : [],
        matched_authors: [],
        display: {
          show_book_cards: !!suggestionBook,
          show_author_cards: false,
        },
      };
    }

    const matchedBooksRaw = await this.matchBooks(prompt, books);
    const matchedAuthorsRaw = this.matchAuthors(prompt, authors, matchedBooksRaw);
    const refined = this.postFilterByIntent(prompt, matchedBooksRaw, matchedAuthorsRaw, aiDecision.mode);
    const matchedBooks = refined.books;
    const matchedAuthors = refined.authors;

    const wikiQuery = matchedBooks[0]?.title || matchedAuthors[0]?.name || prompt;
    const wikiContext = await this.fetchWikipediaExtract(wikiQuery);
    const catalogInsights = this.buildCatalogInsights(books, authors);

    const richTokenTarget = Math.max(320, maxNewTokens);

    const localResult = this.buildGenerativeText(
      prompt,
      matchedBooks,
      matchedAuthors,
      wikiContext,
      richTokenTarget,
      catalogInsights,
      aiDecision
    );

    const compactContext = JSON.stringify({
      mode: aiDecision.mode,
      confidence: aiDecision.confidence,
      query: prompt,
      books: matchedBooks.map((book) => ({
        title: getBookTitle(book),
        description: truncateWords(getBookDescription(book), 90),
        author: getBookAuthorNames(book),
        price: getBookPrimarySellingPrice(book),
        category: getBookCategoryNames(book),
        language: book.language || "",
      })),
      authors: matchedAuthors.map((a) => ({
        name: a.name,
        bio: a.bio || "",
        book_count: a.book_count || 0,
      })),
      wiki_context: wikiContext?.extract || "",
      catalog_insights: catalogInsights,
    });
    const llamaResult = await this.generateWithLlama(prompt, compactContext, richTokenTarget);
    const coreResult = llamaResult || localResult;
    const helpfulInfo = this.buildHelpfulInfoBlock(
      matchedBooks,
      matchedAuthors,
      wikiContext,
      catalogInsights
    );
    const result = `${stripLinks(coreResult)}\n\n${helpfulInfo}`;

    const mode = aiDecision.mode || "general";
    const finalConstraints = this.parseQueryConstraints(prompt, books, authors);
    const forceFullAuthorPayload = finalConstraints.mentionedAuthors.length > 0 || detectIntent(prompt).asksAuthor;
    const shapedBooks = matchedBooks.map((book) => this.slimBookForIntent(book, mode));
    const shapedAuthors = matchedAuthors.map((author) =>
      this.slimAuthorForIntent(author, mode, forceFullAuthorPayload)
    );

    return {
      result,
      matched_books: shapedBooks,
      matched_authors: shapedAuthors,
      display: refined.display,
    };
  }
}

const llmEngine = new LLMEngine();

module.exports = {
  llmEngine,
  MODEL_ID,
};
