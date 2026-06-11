import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import verificationRouter from "./verification";
import platformRouter from "./platform";
import plansRouter from "./plans";
import challengesRouter from "./challenges";
import matchesRouter from "./matches";
import rankingsRouter from "./rankings";
import gamificationRouter from "./gamification";
import notificationsRouter from "./notifications";
import analyticsRouter from "./analytics";
import paymentsRouter from "./payments";
import announcementsRouter from "./announcements";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(verificationRouter);
router.use(platformRouter);
router.use(plansRouter);
router.use(challengesRouter);
router.use(matchesRouter);
router.use(rankingsRouter);
router.use(gamificationRouter);
router.use(notificationsRouter);
router.use(analyticsRouter);
router.use(paymentsRouter);
router.use(announcementsRouter);
router.use(adminRouter);

export default router;
