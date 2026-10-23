import express from "express";
import healthRouter from "./routes/health.routes.js";
import metricsRouter from "./routes/metrics.routes.js";

const app = express();

app.use(express.json());
app.use("/health", healthRouter);
app.use("/metrics", metricsRouter);

export default app;
