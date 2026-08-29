import { describe, expect, it } from "bun:test";
import { resolveGitHubRepository } from "./ship-repository";

function result(stdout: string, code = 0) {
  return {
    stdout,
    code,
    killed: false,
  };
}

describe("ship repository resolution", () => {
  it("prefers GitHub's canonical repository identity over a renamed origin", async () => {
    const repository = await resolveGitHubRepository(
      async () => result("https://github.com/Project-Lit/litflows-web.git\n"),
      async () => result("Project-Lit/litflows\n"),
    );

    expect(repository).toEqual({
      owner: "Project-Lit",
      repository: "litflows",
    });
  });

  it("falls back to origin when canonical GitHub resolution fails", async () => {
    const repository = await resolveGitHubRepository(
      async () => result("git@github.com:Project-Lit/litflows-web.git\n"),
      async () => result("", 1),
    );

    expect(repository).toEqual({
      owner: "Project-Lit",
      repository: "litflows-web",
    });
  });
});
