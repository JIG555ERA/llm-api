const { llmEngine } = require("../src/mlEngine");
const { validateGenerationRequest } = require("../src/validation");

let modelLoaded = false;

async function ensureLoaded() {
  if (modelLoaded) return;
  await llmEngine.loadModel();
  modelLoaded = true;
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method Not Allowed" });
  }

  const requestTimestamp = new Date().toISOString();
  const { isValid, errors, value } = validateGenerationRequest(req.body);
  if (!isValid) {
    return res.status(422).json({
      detail: errors,
      request_timestamp: requestTimestamp,
    });
  }

  try {
    await ensureLoaded();
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

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({
      detail: error.message,
      request_timestamp: requestTimestamp,
    });
  }
};
