import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rfpRoutes from "./routes/rfpRoutes";
import vendorRoutes from "./routes/vendorRoutes";
import proposalRoutes from "./routes/proposalRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimiter";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
    "http://localhost:3000",
    "https://rfp-management-frontend.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Apply rate limiting
app.use("/api/", apiLimiter);

// Routes
app.use("/api/rfps", rfpRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/proposals", proposalRoutes);

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
