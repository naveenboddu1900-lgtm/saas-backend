const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("Backend Running");
});

app.get("/api/users", (req, res) => {
  res.json([
    { id: 1, name: "Naveen" },
    { id: 2, name: "Kumar" }
  ]);
});

app.get("/api/products", (req, res) => {
  res.json([
    { id: 1, name: "Laptop", price: 50000 },
    { id: 2, name: "Mobile", price: 20000 }
  ]);
});

const PORT = 5001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});