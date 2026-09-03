import { Router } from "express";
import { pool } from "../db";

export const healthRouter = Router();

healthRouter.get("/healthz", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.status(200).json({ status: "ok" });
  } catch (error) {
    res.status(503).json({ status: "unavailable", error: (error as Error).message });
  }
});

