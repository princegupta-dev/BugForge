import express from "express";
import healthRouter from "./routes/health.routes.js";
import { getRuntimeMetrics } from "./services/metrics.service.js";

const app = express();

app.use(express.json());
app.use("/health", healthRouter);

app.get("/metrics", (_req, res) => {
  res.json(getRuntimeMetrics());
});

export default app;
