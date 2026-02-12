const app = require("./src/app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TinyLlama API running on http://localhost:${PORT}`);
});
