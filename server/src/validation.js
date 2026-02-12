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
      session_id:
        typeof body?.session_id === "string" && body.session_id.trim()
          ? body.session_id.trim()
          : "default",
    },
  };
}

module.exports = {
  validateGenerationRequest,
};
