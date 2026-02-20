const { llmEngine } = require("../src/mlEngine");
const { validateBookSearchRequest } = require("../src/validation");

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
  const { isValid, errors, value } = validateBookSearchRequest(req.body);
  if (!isValid) {
    return res.status(422).json({
      detail: errors,
      request_timestamp: requestTimestamp,
    });
  }

  try {
    await ensureLoaded();
    const result = await llmEngine.searchBooks(value);
    return res.status(200).json({
      request_timestamp: requestTimestamp,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      detail: error.message,
      request_timestamp: requestTimestamp,
    });
  }
};
