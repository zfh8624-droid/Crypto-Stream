import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import klineRouter from "./kline.js";
import notifyRouter from "./notify.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(klineRouter);
router.use(notifyRouter);

export default router;
