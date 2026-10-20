import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { iconCodepoints } from "$/styles/mdi_icons";
import { InputSchema, prepare } from "../src/label.js";
import { renderLabel } from "../src/chrome.js";
import { CHROME } from "./helpers.js";

const md = readFileSync(new URL("../skills/niimblue/SKILL.md", import.meta.url), "utf8");
const recipes = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));

describe("SKILL.md", () => {
  it("has YAML-safe frontmatter", () => {
    const fm = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    expect(fm).toMatch(/^name: niimblue$/m);
    expect(fm).toMatch(/^description: '(?:[^']|'')+'$/m); // unquoted ": " silently drops the skill
  });

  it("has 8 recipes the schema accepts", () => {
    expect(recipes).toHaveLength(8);
    for (const r of recipes) expect(InputSchema.safeParse(r).error).toBeUndefined();
  });

  it("names only real icons", () => {
    const names = [...md.split("## Icons")[1].split("\n## ")[0].matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]).filter((n) => n !== "Icon");
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => !(n in iconCodepoints))).toEqual([]);
  });

  it.skipIf(!CHROME && !process.env.CI).each(recipes.map((r, i) => [i + 1, r] as const))("recipe %i renders with zero warnings", async (_, r) => {
    const { input, warnings } = prepare(InputSchema.parse(r));
    expect([...warnings, ...(await renderLabel(input)).warnings]).toEqual([]);
  });
});
