import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rfpRoutes from "./routes/rfpRoutes";
import vendorRoutes from "./routes/vendorRoutes";
import webhookRoutes from "./routes/webhookRoutes"
import proposalRoutes from "./routes/proposalRoutes";
import emailRoutes from "./routes/emailRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { apiLimiter } from "./middleware/rateLimiter";

dotenv.config();

const app = express();

// IMPORTANT: Trust proxy for Vercel
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
    "http://localhost:5173",
    "https://rfp-management-frontend.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman, webhooks)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ]
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Apply rate limiting (SKIP for webhooks)
app.use("/api/rfps", apiLimiter);
app.use("/api/vendors", apiLimiter);
app.use("/api/proposals", apiLimiter);
app.use("/api/emails", apiLimiter);

// Routes
app.use("/api/rfps", rfpRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/proposals", proposalRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/webhooks", webhookRoutes);

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

export default app; // Export for Vercel