import express from "express";
import healthRouter from "./routes/health.routes.js";
import { getRuntimeMetrics } from "./services/metrics.service.js";

const app = express();

const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use("/health", healthRouter);

app.get("/metrics", (_req, res) => {
  res.json(getRuntimeMetrics());
});

export default app;

app.listen(PORT, () => {
  console.log(`Runtime Doctor running at http://localhost:${PORT}`);
});
