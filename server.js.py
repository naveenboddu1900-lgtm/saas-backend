require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("MongoDB Connected");
})
.catch((err) => {
    console.log(err);
});

// Test Route
app.get("/", (req, res) => {
    res.send("Backend Running Successfully");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});