import { describe, expect, it } from "vitest";
import { APP_NAME } from "./app-info";

describe("app-info", () => {
  it("has a name", () => {
    expect(APP_NAME).toBe("Editor");
  });
});
