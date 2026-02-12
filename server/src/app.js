require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { llmEngine, MODEL_ID } = require("./mlEngine");
const { validateGenerationRequest } = require("./validation");

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
  const { isValid, errors, value } = validateGenerationRequest(req.body);
  if (!isValid) {
    return res.status(422).json({
      detail: errors,
    });
  }

  try {
    const generation = await llmEngine.generate(
      value.prompt,
      value.max_tokens,
      value.temperature
    );

    const response = {
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
    });
  }
});

module.exports = app;
