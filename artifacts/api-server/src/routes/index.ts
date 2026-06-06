import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import verificationRouter from "./verification";
import platformRouter from "./platform";
import plansRouter from "./plans";
import challengesRouter from "./challenges";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(verificationRouter);
router.use(platformRouter);
router.use(plansRouter);
router.use(challengesRouter);

export default router;
