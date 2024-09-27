const express = require("express");
const app = express();
const createPool = require("./db"); // Import createPool function from db.js
const cors = require("cors");

// MySQL pool configuration
const db = createPool();

// Middleware to parse JSON bodies
app.use(express.json());
app.use(
  cors({
    origin: "*",
  })
);
// Import API routes
const userRoutes = require("./services/login");
const productRoutes = require("./services/product");
const addressRoutes = require("./services/adress");
const cartRoutes = require("./services/cart");
const orderRoutes = require("./services/orders");

// Use API routes
app.use("/api", userRoutes);
app.use("/api", productRoutes);
app.use("/api", addressRoutes);
app.use("/api", cartRoutes);
app.use("/api", orderRoutes);

// Handle MySQL connection errors
db.on("error", (err) => {
  console.error("MySQL pool is_error", err.message);
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
