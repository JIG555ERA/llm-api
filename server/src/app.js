require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { llmEngine, MODEL_ID } = require("./mlEngine");
const {
  validateGenerationRequest,
  validateBookSummaryRequest,
  validateBookSearchRequest,
} = require("./validation");

const app = express();

app.use(cors());
app.use(express.json());

llmEngine.loadModel().catch((error) => {
  console.error("Model setup failed:", error.message);
});

app.get("/", (req, res) => {
  res.json({ status: "online", model: MODEL_ID });
});

app.post("/generate", async (req, res) => {
  const requestTimestamp = new Date().toISOString();
  const { isValid, errors, value } = validateGenerationRequest(req.body);
  if (!isValid) {
    return res.status(422).json({
      detail: errors,
      request_timestamp: requestTimestamp,
    });
  }

  try {
    const generation = await llmEngine.generate(
      value.prompt,
      value.max_tokens,
      value.temperature
    );

    const response = {
      request_timestamp: requestTimestamp,
      result: generation.result,
      token_usage: generation.result.split(/\s+/).filter(Boolean).length,
      matched_books: generation.matched_books,
    };

    if (Array.isArray(generation.matched_authors) && generation.matched_authors.length > 0) {
      response.matched_authors = generation.matched_authors;
    }

    if (generation.display) {
      response.display = generation.display;
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({
      detail: error.message,
      request_timestamp: requestTimestamp,
    });
  }
});

app.post("/book-summary", async (req, res) => {
  const requestTimestamp = new Date().toISOString();
  const { isValid, errors, value } = validateBookSummaryRequest(req.body);
  if (!isValid) {
    return res.status(422).json({
      detail: errors,
      request_timestamp: requestTimestamp,
    });
  }

  try {
    const summary = await llmEngine.summarizeBook(value);
    return res.json({
      request_timestamp: requestTimestamp,
      ...summary,
    });
  } catch (error) {
    return res.status(500).json({
      detail: error.message,
      request_timestamp: requestTimestamp,
    });
  }
});

app.post("/books/search", async (req, res) => {
  const requestTimestamp = new Date().toISOString();
  const { isValid, errors, value } = validateBookSearchRequest(req.body);
  if (!isValid) {
    return res.status(422).json({
      detail: errors,
      request_timestamp: requestTimestamp,
    });
  }

  try {
    const result = await llmEngine.searchBooks(value);
    return res.json({
      request_timestamp: requestTimestamp,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      detail: error.message,
      request_timestamp: requestTimestamp,
    });
  }
});

module.exports = app;
