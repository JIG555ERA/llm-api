function validateGenerationRequest(body) {
  const errors = [];

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    errors.push("prompt is required and must be a non-empty string.");
  }

  const maxTokens = body?.max_tokens ?? 256;
  if (!Number.isInteger(maxTokens) || maxTokens < 10 || maxTokens > 1024) {
    errors.push("max_tokens must be an integer between 10 and 1024.");
  }

  const temperature = body?.temperature ?? 0.7;
  if (typeof temperature !== "number" || temperature < 0 || temperature > 1) {
    errors.push("temperature must be a number between 0.0 and 1.0.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      prompt,
      max_tokens: maxTokens,
      temperature,
    },
  };
}

function validateBookSummaryRequest(body) {
  const errors = [];

  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    errors.push("query is required and must be a non-empty string.");
  }

  const author = typeof body?.author === "string" ? body.author.trim() : "";
  const entityType = typeof body?.entity_type === "string" ? body.entity_type.trim().toLowerCase() : "auto";
  if (!["auto", "book", "author", "publisher"].includes(entityType)) {
    errors.push("entity_type must be one of: auto, book, author, publisher.");
  }
  const language = typeof body?.language === "string" ? body.language.trim() : "en";
  const tone = typeof body?.tone === "string" ? body.tone.trim() : "insightful";

  const includeQuotes = body?.include_quotes ?? true;
  if (typeof includeQuotes !== "boolean") {
    errors.push("include_quotes must be a boolean.");
  }

  const includeKeyTakeaways = body?.include_key_takeaways ?? true;
  if (typeof includeKeyTakeaways !== "boolean") {
    errors.push("include_key_takeaways must be a boolean.");
  }

  const includeSimilarBooks = body?.include_similar_books ?? true;
  if (typeof includeSimilarBooks !== "boolean") {
    errors.push("include_similar_books must be a boolean.");
  }

  const maxTokens = body?.max_tokens ?? 700;
  if (!Number.isInteger(maxTokens) || maxTokens < 200 || maxTokens > 1800) {
    errors.push("max_tokens must be an integer between 200 and 1800.");
  }

  const temperature = body?.temperature ?? 0.7;
  if (typeof temperature !== "number" || temperature < 0 || temperature > 1) {
    errors.push("temperature must be a number between 0.0 and 1.0.");
  }

  const topKSimilar = body?.top_k_similar ?? 4;
  if (!Number.isInteger(topKSimilar) || topKSimilar < 1 || topKSimilar > 10) {
    errors.push("top_k_similar must be an integer between 1 and 10.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      query,
      author,
      entity_type: entityType,
      language: language || "en",
      tone: tone || "insightful",
      include_quotes: includeQuotes,
      include_key_takeaways: includeKeyTakeaways,
      include_similar_books: includeSimilarBooks,
      max_tokens: maxTokens,
      temperature,
      top_k_similar: topKSimilar,
    },
  };
}

function validateBookSearchRequest(body) {
  const errors = [];

  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    errors.push("query is required and must be a non-empty string.");
  }

  const page = body?.page ?? 1;
  if (!Number.isInteger(page) || page < 1) {
    errors.push("page must be an integer greater than or equal to 1.");
  }

  const perPage = body?.per_page ?? 20;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50) {
    errors.push("per_page must be an integer between 1 and 50.");
  }

  const includeGoogleEnrichment = body?.include_google_enrichment ?? true;
  if (typeof includeGoogleEnrichment !== "boolean") {
    errors.push("include_google_enrichment must be a boolean.");
  }

  const includeBookDetails = body?.include_book_details ?? true;
  if (typeof includeBookDetails !== "boolean") {
    errors.push("include_book_details must be a boolean.");
  }

  const enrichTopN = body?.enrich_top_n ?? 10;
  if (!Number.isInteger(enrichTopN) || enrichTopN < 0 || enrichTopN > 50) {
    errors.push("enrich_top_n must be an integer between 0 and 50.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      query,
      page,
      per_page: perPage,
      include_google_enrichment: includeGoogleEnrichment,
      include_book_details: includeBookDetails,
      enrich_top_n: enrichTopN,
    },
  };
}

module.exports = {
  validateGenerationRequest,
  validateBookSummaryRequest,
  validateBookSearchRequest,
};
