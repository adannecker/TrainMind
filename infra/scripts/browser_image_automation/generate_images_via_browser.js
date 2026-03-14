const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function decodeDataUriToBuffer(dataUri) {
  const match = dataUri.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

async function waitForComposer(page, timeoutMs) {
  const selectors = [
    "#prompt-textarea",
    "textarea[placeholder*='Message']",
    "textarea",
  ];
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: Math.min(timeoutMs, 4000) });
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0) {
        return loc;
      }
    } catch {
      // try next selector
    }
  }
  throw new Error("Prompt input not found. Make sure you are on chatgpt.com and logged in.");
}

async function sendPrompt(page, promptText) {
  const composer = await waitForComposer(page, 15000);
  await composer.click();
  await composer.fill(promptText);

  const sendSelectors = [
    "button[data-testid='send-button']",
    "button[aria-label*='Send']",
  ];

  for (const selector of sendSelectors) {
    const btn = page.locator(selector).first();
    if ((await btn.count()) > 0 && (await btn.isEnabled().catch(() => false))) {
      await btn.click();
      return;
    }
  }

  // Fallback: Enter key
  await composer.press("Enter");
}

async function waitForNewImage(page, previousCount, timeoutMs) {
  const started = Date.now();
  const selector = "main img";

  while (Date.now() - started < timeoutMs) {
    const count = await page.locator(selector).count();
    if (count > previousCount) {
      return true;
    }
    await page.waitForTimeout(1200);
  }
  return false;
}

async function getLastImageInfo(page) {
  const imgs = page.locator("main img");
  const count = await imgs.count();
  if (count === 0) return null;

  const last = imgs.nth(count - 1);
  const src = await last.getAttribute("src");
  return { src, element: last };
}

async function saveImageFromPage(page, imageInfo, outFile) {
  ensureDir(outFile);

  if (!imageInfo || !imageInfo.src) {
    throw new Error("No image source found.");
  }

  const dataBuffer = decodeDataUriToBuffer(imageInfo.src);
  if (dataBuffer) {
    fs.writeFileSync(outFile, dataBuffer);
    return;
  }

  if (imageInfo.src.startsWith("http://") || imageInfo.src.startsWith("https://")) {
    const res = await page.request.get(imageInfo.src);
    if (res.ok()) {
      fs.writeFileSync(outFile, await res.body());
      return;
    }
  }

  // Fallback: element screenshot
  await imageInfo.element.screenshot({ path: outFile });
}

function loadJobs(args) {
  if (args.jobs) {
    const jobsPath = path.resolve(args.jobs);
    const raw = fs.readFileSync(jobsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Jobs file must contain a non-empty array.");
    }
    return parsed.map((j) => {
      if (!j.prompt || !j.output) {
        throw new Error("Each job needs 'prompt' and 'output'.");
      }
      return { prompt: String(j.prompt), output: String(j.output) };
    });
  }

  if (args.prompt && args.output) {
    return [{ prompt: String(args.prompt), output: String(args.output) }];
  }

  throw new Error("Usage: --jobs <file.json> OR --prompt <text> --output <path>");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs = loadJobs(args);
  const url = args.url || "https://chatgpt.com/";
  const timeoutSec = Number(args.timeoutSec || 240);
  const timeoutMs = Math.max(30, timeoutSec) * 1000;

  const profileDir = path.resolve(args.profileDir || "data/browser/openai-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`Using profile dir: ${profileDir}`);
  console.log(`Opening: ${url}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded" });

    console.log("If needed, log in manually in this browser window.");
    console.log("After login, keep the chat page open. Starting jobs in 8 seconds...");
    await page.waitForTimeout(8000);

    for (const [idx, job] of jobs.entries()) {
      const outPath = path.resolve(job.output);
      const previousCount = await page.locator("main img").count();
      console.log(`Job ${idx + 1}/${jobs.length}: ${job.output}`);

      await sendPrompt(page, job.prompt);
      const hasNewImage = await waitForNewImage(page, previousCount, timeoutMs);
      if (!hasNewImage) {
        throw new Error(`Timeout waiting for image: ${job.output}`);
      }

      // Give UI a moment to finalize preview/download URL
      await page.waitForTimeout(1500);
      const imageInfo = await getLastImageInfo(page);
      await saveImageFromPage(page, imageInfo, outPath);
      console.log(`Saved: ${outPath}`);
      await page.waitForTimeout(1200);
    }

    console.log("All jobs completed.");
  } finally {
    if (args.keepOpen) {
      console.log("Browser kept open because --keepOpen is set.");
    } else {
      await context.close();
    }
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
