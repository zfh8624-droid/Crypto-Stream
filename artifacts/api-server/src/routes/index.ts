import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import klineRouter from "./kline.js";
import notifyRouter from "./notify.js";
import authRouter from "./auth.js";
import monitorsRouter from "./monitors.js";
import usersRouter from "./users.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(klineRouter);
router.use(notifyRouter);
router.use(monitorsRouter);
router.use(usersRouter);

export default router;
