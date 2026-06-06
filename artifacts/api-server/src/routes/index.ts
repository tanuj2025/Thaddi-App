import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import verificationRouter from "./verification";
import platformRouter from "./platform";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(verificationRouter);
router.use(platformRouter);

export default router;
