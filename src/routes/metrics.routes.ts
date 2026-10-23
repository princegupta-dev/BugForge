import { Router } from "express";
import {
  getRuntimeMetrics,
  resetRuntimeMetrics,
} from "../services/metrics.service.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(getRuntimeMetrics());
});

// Lets a benchmark start each phase with an empty event-loop delay histogram.
router.post("/reset", (_req, res) => {
  resetRuntimeMetrics();
  res.status(204).end();
});

export default router;
