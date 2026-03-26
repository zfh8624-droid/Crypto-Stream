import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

const DINGTALK_URL =
  "https://oapi.dingtalk.com/robot/send?access_token=a5214afa0698ca62e74ad87dc1053ac151fb04caee08ae044d053bca883dce97";

async function sendDingTalk(content: string) {
  const res = await fetch(DINGTALK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content } }),
  });
  if (!res.ok) throw new Error(`DingTalk API error: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

router.post("/notify/send", async (req, res) => {
  const { content } = req.body as { content?: string };
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  try {
    const result = await sendDingTalk(content);
    res.json({ success: true, result });
  } catch (err) {
    logger.error({ err }, "DingTalk send failed");
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.post("/notify/test", async (_req, res) => {
  try {
    const result = await sendDingTalk(
      "🔧 连通性测试\n\n这是来自【实时价格追踪器】的测试消息，钉钉机器人连接正常！"
    );
    res.json({ success: true, result });
  } catch (err) {
    logger.error({ err }, "DingTalk test failed");
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
