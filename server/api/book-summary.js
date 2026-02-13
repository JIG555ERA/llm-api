const { llmEngine } = require("../src/mlEngine");
const { validateBookSummaryRequest } = require("../src/validation");

let modelLoaded = false;

async function ensureLoaded() {
  if (modelLoaded) return;
  await llmEngine.loadModel();
  modelLoaded = true;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method Not Allowed" });
  }

  const requestTimestamp = new Date().toISOString();
  const { isValid, errors, value } = validateBookSummaryRequest(req.body);
  if (!isValid) {
    return res.status(422).json({
      detail: errors,
      request_timestamp: requestTimestamp,
    });
  }

  try {
    await ensureLoaded();
    const summary = await llmEngine.summarizeBook(value);
    return res.status(200).json({
      request_timestamp: requestTimestamp,
      ...summary,
    });
  } catch (error) {
    return res.status(500).json({
      detail: error.message,
      request_timestamp: requestTimestamp,
    });
  }
};
