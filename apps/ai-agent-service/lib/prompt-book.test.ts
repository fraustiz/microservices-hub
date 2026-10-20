import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASK_PROMPT, SUMMARIZE_PROMPT } from "./prompts";

/** Le Prompt Book (docs/prompt-book.md) doit reproduire exactement les prompts du code, avec leur version. */
const book = readFileSync(new URL("../../../docs/prompt-book.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function documented(id: string): string | undefined {
  const block = new RegExp(`<!-- prompt:${id.replace(".", "\\.")} -->\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /prompt -->`);
  return book.match(block)?.[1];
}

describe.each([ASK_PROMPT, SUMMARIZE_PROMPT])("Prompt Book : $id", (prompt) => {
  it("même texte que le code", () => {
    expect(documented(prompt.id)).toBe(prompt.system);
  });

  it("même version et mêmes paramètres dans le catalogue", () => {
    const temperature = String(prompt.temperature).replace(".", ",");
    const reasoning = prompt.reasoning ? "activé" : "désactivé";
    expect(book).toContain(`| \`${prompt.id}\` | \`${prompt.version}\` |`);
    expect(book).toMatch(
      new RegExp(`\\| \`${prompt.id}\` \\| \`${prompt.version}\` \\|.*\\| ${temperature} \\| ${prompt.maxTokens} \\| ${reasoning} \\|`),
    );
  });
});
