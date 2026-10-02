import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type {
  Campaign,
  DMTurnResponse,
  Evidence,
  RollRequest,
  RollResult,
  SavedTable,
} from "../src/dmTypes";

// These journeys mock only the paid model boundary. Rule lookup and dice use
// the real application server. The text below is authored test data, not a
// captured GPT-5.6 Sol response or evidence of live model quality.
const TEST_KEY = "sk-test-rulekeeper-browser-fixture-only";
const OPENING =
  "Rain stipples the surface of Blackwater Mere. Across the flooded road, a bell rings from a chapel that has stood empty for thirty years.\n\n" +
  "At the ferry landing, a woman in a patched blue coat holds a lantern low over the water. ‘Three rings,’ she says. ‘That means someone is still inside.’ A narrow stair leads down beneath the ruined tower. What do you do?";
const CHECK_SCENE =
  "The ironbound door has swollen in its frame. Mara sets a shoulder against it while lamplight trembles over the carved lintel. Beyond the wood, you hear a single measured knock.\n\n" +
  "Forcing the door could get you inside quickly, but the noise will carry up the tower. Make the Strength check before we find out whether it opens.";
const CHECK: RollRequest = {
  label: "Mara's Strength check",
  notation: "1d20+3",
  mode: "normal",
  reason: "Force the chapel's swollen door before the water rises.",
};

type TurnBody = { campaign: Campaign; action: string; roll: RollResult | null };

function campaignFixture(): Campaign {
  return {
    id: "blackwater-test-campaign",
    title: "The Bell at Blackwater",
    premise:
      "A sunken chapel bell has begun ringing. Find the missing ferryman before the water rises.",
    tone: "Mysterious & atmospheric",
    characters: [
      {
        id: "mara-test-character",
        name: "Mara Venn",
        ancestry: "Human",
        class_name: "Fighter",
        level: 3,
        hp: 28,
        max_hp: 28,
        armor_class: 16,
        notes: "Strength checks +3. Carries a lantern and a length of rope.",
      },
    ],
    location: "Blackwater ferry landing",
    summary:
      "Mara came to Blackwater to find the missing ferryman. The chapel bell rang three times.",
    quests: ["Find the missing ferryman"],
    npcs: ["Elin, the ferryman's sister, waits at the landing"],
    inventory: ["Lantern", "50 feet of rope"],
    turn_count: 1,
    history: [
      { role: "player", text: "Begin the adventure." },
      { role: "dm", text: OPENING },
    ],
    pending_roll: null,
  };
}

function turnFixture(
  request: TurnBody,
  narration: string,
  evidence: Evidence[],
  pendingRoll: RollRequest | null = null,
): DMTurnResponse {
  const history: Campaign["history"] = [
    ...request.campaign.history,
    { role: "player", text: request.action },
    { role: "dm", text: narration },
  ];
  return {
    campaign: {
      ...request.campaign,
      location: "The flooded chapel",
      summary:
        "Mara reached the chapel and heard a knock behind the swollen door. Elin is waiting at the ferry landing.",
      quests: ["Find the missing ferryman"],
      npcs: ["Elin, the ferryman's sister"],
      inventory: ["Lantern", "50 feet of rope"],
      turn_count: request.campaign.turn_count + 1,
      history: history.slice(-200),
      pending_roll: pendingRoll,
    },
    narration,
    rulings: evidence.length
      ? [
          {
            text: "An ability check resolves an uncertain attempt to overcome a challenge, such as forcing open a stuck door.",
            citations: [1],
          },
        ]
      : [],
    evidence,
    roll: request.roll,
    usage: { input_tokens: 1720, output_tokens: 290, total_tokens: 2010 },
    model: "gpt-5.6-sol",
  };
}

async function mockConnection(page: Page) {
  await page.route("**/api/dm/connect", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${TEST_KEY}`);
    await route.fulfill({ json: { model: "gpt-5.6-sol" } });
  });
}

async function realEvidence(page: Page): Promise<Evidence[]> {
  const response = await page.request.get(
    "/api/rules?q=Ability%20Checks&limit=10",
  );
  expect(response.ok()).toBe(true);
  const data = await response.json();
  const passage = data.items.find(
    (item: { title: string; page_start: number }) =>
      item.title === "Ability Checks" && item.page_start === 6,
  );
  expect(passage).toBeTruthy();
  return [
    {
      ...passage,
      citation: 1,
      score: 1,
      lexical_score: 1,
      dense_score: 1,
      rerank_score: null,
    },
  ];
}

async function importCampaign(
  page: Page,
  campaign: Campaign,
  notes: SavedTable["notes"] = {},
) {
  const document: SavedTable = {
    version: 1,
    campaign,
    notes,
    pendingRoll: null,
  };
  await page.getByLabel("Import campaign file", { exact: true }).setInputFiles({
    name: "blackwater-campaign.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
}

async function expectKeyAbsentFromStorage(page: Page) {
  const stored = await page.evaluate(() => ({
    ...localStorage,
    ...sessionStorage,
  }));
  expect(JSON.stringify(stored)).not.toContain(TEST_KEY);
}

async function connect(page: Page) {
  await page.getByLabel("OpenAI API key", { exact: true }).fill(TEST_KEY);
  await page.getByRole("button", { name: "Connect key", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
}

async function exportDocument(page: Page): Promise<SavedTable> {
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("the-bell-at-blackwater.json");
  const path = await download.path();
  expect(path).not.toBeNull();
  const text = await readFile(path!, "utf8");
  expect(text).not.toContain(TEST_KEY);
  return JSON.parse(text) as SavedTable;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await mockConnection(page);
  await page.goto("/");
  await expect(page.locator(".library-status")).toContainText("Library ready");
  const menu = page.getByRole("button", {
    name: "Toggle navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Dungeon Master", exact: true })
    .click();
});

test("mocked DM: prepare, play with real dice and sources, export, and resume", async ({
  page,
}, testInfo) => {
  await expect(
    page.getByRole("heading", { name: "Create a campaign" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("dm-onboarding.png"),
    fullPage: false,
  });

  const evidence = await realEvidence(page);
  const requests: TurnBody[] = [];
  let diceRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/dm/roll") diceRequests += 1;
  });
  let resolution = "";
  await page.route("**/api/dm/turn", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${TEST_KEY}`);
    const body = route.request().postDataJSON() as TurnBody;
    requests.push(body);
    expect(body.campaign.history.length).toBeLessThanOrEqual(12);
    if (requests.length === 1) {
      expect(body.campaign.characters[0].name).toBe("Mara Venn");
      await route.fulfill({ json: turnFixture(body, OPENING, []) });
    } else if (requests.length === 2) {
      expect(body.action).toBe("Mara tries to force the chapel door open.");
      expect(body.campaign.summary).toContain("Elin");
      await route.fulfill({
        json: turnFixture(body, CHECK_SCENE, evidence, CHECK),
      });
    } else {
      const roll = body.roll;
      expect(roll).not.toBeNull();
      expect(roll!.request).toEqual(CHECK);
      expect(roll!.rolls).toHaveLength(1);
      expect(roll!.rolls[0]).toBeGreaterThanOrEqual(1);
      expect(roll!.rolls[0]).toBeLessThanOrEqual(20);
      expect(roll!.total).toBe(roll!.rolls[0] + 3);
      resolution =
        roll!.total >= 13
          ? "The door gives with a crack. Beyond it, a wet rope descends into the dark. Someone has tied a fresh knot in the end."
          : "The swollen door holds. As Mara steps back, the lantern catches a narrow window above the lintel. Beyond it, a wet rope descends into the dark.";
      await route.fulfill({ json: turnFixture(body, resolution, evidence) });
    }
  });

  await page
    .getByLabel("Campaign title", { exact: true })
    .fill("The Bell at Blackwater");
  await page
    .getByLabel("Adventure premise", { exact: false })
    .fill(campaignFixture().premise);
  await page.getByLabel("Character 1 name", { exact: true }).fill("Mara Venn");
  await page
    .getByLabel("Character 1 notes", { exact: true })
    .fill(campaignFixture().characters[0].notes);
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Begin adventure", exact: true }),
  ).toBeDisabled();
  await connect(page);
  await expectKeyAbsentFromStorage(page);
  await page
    .getByRole("button", { name: "Begin adventure", exact: true })
    .click();
  await expect(page.locator(".dm-narration")).toContainText(
    "Rain stipples the surface of Blackwater Mere.",
  );
  await expect(page.locator(".dm-memory-panel")).toContainText("Elin");
  await expectNoHorizontalOverflow(page);
  // Let the journal's scheduled scroll finish, then frame the campaign masthead.
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: testInfo.outputPath("dm-session.png"),
    fullPage: false,
  });

  await page
    .getByRole("textbox", { name: "Your action", exact: true })
    .fill("Mara tries to force the chapel door open.");
  await page.getByRole("button", { name: "Take action", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Requested dice roll" }),
  ).toContainText(CHECK.label);
  await expect(
    page.getByRole("textbox", { name: "Your action", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Roll and continue", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Requested dice roll" }),
  ).toHaveCount(0);
  await expect(page.locator(".dm-narration").last()).toContainText(
    "a wet rope descends into the dark",
  );
  expect(diceRequests).toBe(1);
  expect(requests).toHaveLength(3);
  await page
    .getByRole("button", { name: /Ability Checks/ })
    .last()
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "forcing open a stuck door",
  );
  await expect(
    page.getByRole("link", { name: "Open original page" }),
  ).toHaveAttribute("href", /source\.pdf#page=6$/);
  await page.getByRole("button", { name: "Close source", exact: true }).click();

  const exported = await exportDocument(page);
  expect(exported.version).toBe(1);
  expect(exported.campaign.turn_count).toBe(3);
  expect(exported.campaign.history.at(-1)?.text).toBe(resolution);
  expect(exported.notes["3"].roll).toEqual(requests[2].roll);
  await expectKeyAbsentFromStorage(page);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "The Bell at Blackwater", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".dm-narration").last()).toHaveText(resolution);
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("textbox", { name: "Your action", exact: true })
    .fill("Mara examines the fresh knot.");
  await expect(
    page.getByRole("button", { name: "Take action", exact: true }),
  ).toBeDisabled();
  await connect(page);
  await expect(
    page.getByRole("button", { name: "Take action", exact: true }),
  ).toBeEnabled();
});

test("mocked DM failure: preserve the real roll across reload and retry it once", async ({
  page,
}) => {
  const campaign = campaignFixture();
  campaign.pending_roll = CHECK;
  campaign.history.push(
    { role: "player", text: "Mara forces the door." },
    { role: "dm", text: CHECK_SCENE },
  );
  campaign.turn_count = 2;
  const attempts: TurnBody[] = [];
  let diceRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/dm/roll") diceRequests += 1;
  });
  await page.route("**/api/dm/turn", async (route) => {
    const body = route.request().postDataJSON() as TurnBody;
    attempts.push(body);
    if (attempts.length === 1) {
      await route.fulfill({
        status: 502,
        json: { detail: "Simulated upstream failure for this test." },
      });
    } else {
      await route.fulfill({
        json: turnFixture(
          body,
          "The knock stops. Whatever lies beyond the door is listening.",
          [],
        ),
      });
    }
  });

  await importCampaign(page, campaign);
  await connect(page);
  await page
    .getByRole("button", { name: "Roll and continue", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated upstream failure for this test.",
  );
  await expect(
    page.getByRole("button", { name: "Continue with this roll", exact: true }),
  ).toBeVisible();
  expect(diceRequests).toBe(1);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].roll).not.toBeNull();
  const failedExport = await exportDocument(page);
  expect(failedExport.campaign.turn_count).toBe(2);
  expect(failedExport.pendingRoll).toEqual(attempts[0].roll);

  await page.reload();
  await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveValue(
    "",
  );
  await connect(page);
  await page
    .getByRole("button", { name: "Continue with this roll", exact: true })
    .click();
  await expect(page.locator(".dm-narration").last()).toContainText(
    "Whatever lies beyond the door is listening.",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1].roll).toEqual(attempts[0].roll);
  expect(diceRequests).toBe(1);
  const recovered = await exportDocument(page);
  expect(recovered.pendingRoll).toBeNull();
  expect(recovered.campaign.turn_count).toBe(3);
  await expectKeyAbsentFromStorage(page);
});

test("mocked DM: verify imported sources and send edited memory with bounded history", async ({
  page,
}) => {
  const campaign = campaignFixture();
  campaign.history = Array.from(
    { length: 7 },
    (_, index) =>
      [
        {
          role: "player",
          text: `Investigate the village, scene ${index + 1}.`,
        },
        {
          role: "dm",
          text: `Previous scene ${index + 1}. The ferryman is still missing.`,
        },
      ] as Campaign["history"],
  ).flat();
  campaign.turn_count = 7;
  const correctedMemory =
    "Elin gave Mara the brass chapel key. The ferryman is still missing.";
  let sent: TurnBody | null = null;
  await page.route("**/api/dm/turn", async (route) => {
    const body = route.request().postDataJSON() as TurnBody;
    sent = body;
    expect(body.campaign.summary).toBe(correctedMemory);
    expect(body.campaign.history).toHaveLength(12);
    expect(body.campaign.history[0].text).toBe(campaign.history[2].text);
    await route.fulfill({
      json: turnFixture(
        body,
        "The brass key turns. Elin was right about the chapel.",
        [],
      ),
    });
  });
  const evidence = await realEvidence(page);
  const forgedText =
    "Forged imported source: every ability check automatically succeeds.";
  await importCampaign(page, campaign, {
    "7": {
      model: "gpt-5.6-sol",
      usage: {},
      roll: null,
      rulings: [
        {
          text: "A saved mechanical ruling for this campaign.",
          citations: [1],
        },
      ],
      evidence: [{ ...evidence[0], text: forgedText }],
    },
  });
  await page.getByRole("button", { name: /Ability Checks/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "forcing open a stuck door",
  );
  await expect(page.getByRole("dialog")).not.toContainText(forgedText);
  await page.getByRole("button", { name: "Close source", exact: true }).click();
  const before = await exportDocument(page);
  await page.getByLabel("Import campaign file", { exact: true }).setInputFiles({
    name: "broken-campaign.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ version: 1, campaign: { title: "Broken" } }),
    ),
  });
  await expect(page.getByRole("alert")).toContainText(
    "isn't a valid RuleKeeper campaign",
  );
  expect((await exportDocument(page)).campaign).toEqual(before.campaign);
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Edit campaign memory", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Story so far", exact: true })
    .fill(correctedMemory);
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /^Open threads/ })
    .fill("");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".dm-memory-panel")).toContainText(
    "the brass chapel key",
  );
  const exported = await exportDocument(page);
  expect(exported.campaign.summary).toBe(correctedMemory);
  expect(exported.campaign.quests).toEqual([]);
  await page.reload();
  await expect(page.locator(".dm-memory-panel")).toContainText(
    "the brass chapel key",
  );
  await connect(page);
  await page
    .getByRole("textbox", { name: "Your action", exact: true })
    .fill("Mara uses the brass chapel key.");
  await page.getByRole("button", { name: "Take action", exact: true }).click();
  await expect(page.locator(".dm-narration").last()).toContainText(
    "The brass key turns.",
  );
  expect(sent).not.toBeNull();
  const continued = await exportDocument(page);
  expect(continued.campaign.history).toHaveLength(16);
  expect(continued.campaign.history[0]).toEqual(campaign.history[0]);
  expect(continued.campaign.turn_count).toBe(8);
  await expectKeyAbsentFromStorage(page);
});
